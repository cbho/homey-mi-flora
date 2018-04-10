'use strict';

const Homey = require('homey');

const APP_VERSION = 'v1.0.0';

const MAX_RETRIES = 3;

const DATA_CHARACTERISTIC_UUID = '00001a0100001000800000805f9b34fb';
const REALTIME_CHARACTERISTIC_UUID = '00001a0000001000800000805f9b34fb';
const FIRMWARE_CHARACTERISTIC_UUID = '00001a0200001000800000805f9b34fb';

Homey.BlePeripheral.prototype.disconnect = function disconnect(callback) {
    if (typeof callback === 'function')
        return Homey.util.callbackAfterPromise(this, this.disconnect, arguments);

    const disconnectPromise = new Promise((resolve, reject) => {
        this._disconnectQueue.push((err, result) => err ? reject(err) : resolve(result));
    });

    if (this._disconnectLockCounter === 0) {
        clearTimeout(this._disconnectTimeout);
        this._disconnectTimeout = setTimeout(() => {
            if (this._disconnectLockCounter === 0) {
                this._disconnected();
                // console.log('called disconnect', new Error().stack);
                this.__client.emit('disconnect', [this._connectionId, this.uuid], err => {
                    this._connectionId = null;
                    this._disconnectQueue.forEach(cb => cb(err));
                    this._disconnectQueue.length = 0;
                });
            }
        }, 100);
    }

    return disconnectPromise;
};

Homey.BlePeripheral.prototype.getService = async function getService(uuid, callback) {
    if (typeof callback === 'function')
        return Homey.util.callbackAfterPromise(this, this.getService, arguments);

    this.resetConnectionWarning();

    let service = Array.isArray(this.services) ? this.services.find(service => service.uuid === uuid) : null;

    if (!service) {
        const [discoveredService] = await this.discoverServices([uuid]);

        if (!discoveredService && !Array.isArray(this.services)) {
            return Promise.reject(new Error('Error, could not get services'));
        }
        service = discoveredService;
    }

    return service || Promise.reject(new Error(`No service found with UUID ${uuid}`));
};

class HomeyMiFlora extends Homey.App {

    onInit() {
        console.log('Successfully init HomeyMiFlora');
        this._registerTriggerCards();
        this._registerConditionalCards();
    }

    getCapabilities() {
        return [
            "measure_temperature",
            "measure_luminance",
            "measure_conductivity",
            "measure_moisture",
            "measure_battery"
        ];
    }

    updateDevices(devices) {
        return devices.reduce((promise, device) => {
            return promise
                .then(() => {
                    device.retry = 0;
                    return this._updateDevice(device);
                }).catch(error => {
                    console.log(error);
                });
        }, Promise.resolve());
    }

    triggerCapabilityChange(device, capability, value) {

        let thresholdMapping = this._getThresholdMapping();

        if (thresholdMapping.hasOwnProperty(capability)) {
            let minValue = device.getSetting(thresholdMapping[capability].min);
            if (value < minValue) {
                console.log('trigger _checkMinThreshold');
                this._deviceSensorThresholdMinExceeds.trigger({
                    'device': device.getName(),
                    'sensor': capability,
                    'value': '' + value
                })
                    .catch(function (error) {
                        console.error('Cannot trigger flow card sensor_threshold_min_exceeds: %s.', error);
                    });
            }
        }

        if (thresholdMapping.hasOwnProperty(capability)) {
            let maxValue = device.getSetting(thresholdMapping[capability].max);
            if (value > maxValue) {
                console.log('trigger _checkMaxThreshold');
                this._deviceSensorThresholdMaxExceeds.trigger({
                    'device': device.getName(),
                    'sensor': capability,
                    'value': '' + value
                })
                    .catch(function (error) {
                        console.error('Cannot trigger flow card sensor_threshold_max_exceeds: %s.', error);
                    });
            }
        }

        this._sensorChanged.trigger({
            'device': device.getName(),
            'sensor': capability,
            'value': '' + value
        })
            .catch(function (error) {
                console.error('Cannot trigger flow card sensor_changed device: %s.', error);
            });

        // this._deviceSensorChanged.trigger({
        //     'sensor': capability,
        //     'value': '' + value
        // })
        //     .catch(function (error) {
        //         console.error('Cannot trigger flow card sensor_changed device: %s.', error);
        //     });
    }

    findDevices(identification, name) {
        return new Promise((resolve, reject) => {
            let devices = [];
            let index = 0;
            Homey.ManagerBLE.discover().then(function (advertisements) {
                advertisements.forEach(function (advertisement) {
                    if (advertisement.localName === identification) {
                        ++index;
                        devices.push({
                            "name": name + " " + index,
                            "data": {
                                "id": advertisement.id,
                                "uuid": advertisement.uuid,
                                "name": advertisement.name,
                                "type": advertisement.type,
                                "version": APP_VERSION,
                            },
                            "capabilities": [
                                "measure_temperature",
                                "measure_luminance",
                                "measure_conductivity",
                                "measure_moisture",
                                "measure_battery"
                            ],
                        });
                    }
                });

                resolve(devices);
            })
                .catch(function (error) {
                    reject('Cannot discover BLE devices from the homey manager. ' + error);
                });
        })
    }

    _registerConditionalCards() {

        let conditionsMapping = {
            "measure_temperature": "measure_temperature_threshold",
            "measure_luminance": "measure_luminance_threshold",
            "measure_conductivity": "measure_conductivity_threshold",
            "measure_moisture": "measure_moisture_threshold"
        };

        this.getCapabilities().forEach(function (capability) {
            if (conditionsMapping.hasOwnProperty(capability)) {
                new Homey.FlowCardCondition(conditionsMapping[capability])
                    .register()
                    .registerRunListener((args, state) => {

                        let minValue = args.device.getSetting(thresholdMapping[capability].min);
                        let maxValue = args.device.getSetting(thresholdMapping[capability].max);
                        let value = args.device.getCapabilityValue(capability);

                        console.log("%s < %s || %s > %s", value, minValue, value, maxValue);

                        return (value < minValue || value > maxValue);
                    });
            }
        });
    }

    // registerDeviceTriggerCards(device) {
    //     console.log(device.getDeviceTriggerCardId() + '_changed');
    //     this._deviceSensorChanged = new Homey.FlowCardTriggerDevice(device.getDeviceTriggerCardId() + '_changed');
    //     this._deviceSensorChanged.register();
    // }

    _registerTriggerCards() {
        this._deviceSensorThresholdMinExceeds = new Homey.FlowCardTrigger('sensor_threshold_min_exceeds');
        this._deviceSensorThresholdMinExceeds.register();

        this._deviceSensorThresholdMaxExceeds = new Homey.FlowCardTrigger('sensor_threshold_max_exceeds');
        this._deviceSensorThresholdMaxExceeds.register();

        this._sensorChanged = new Homey.FlowCardTrigger('sensor_changed');
        this._sensorChanged.register();
    }

    _getThresholdMapping() {
        return {
            "measure_temperature": {
                "min": "measure_temperature_min",
                "max": "measure_temperature_max"
            },
            "measure_luminance": {
                "min": "measure_luminance_min",
                "max": "measure_luminance_max"
            },
            "measure_conductivity": {
                "min": "measure_conductivity_min",
                "max": "measure_conductivity_max"
            },
            "measure_moisture": {
                "min": "measure_moisture_min",
                "max": "measure_moisture_max"
            },
        };
    }

    _updateDevice(device) {
        return new Promise((resolve, reject) => {
            console.log('update device ' + device.getName());
            this._handleUpdateSequence(device)
                .then(device => {
                    device.retry = 0;
                    resolve(device);
                })
                .catch(error => {
                    device.retry++;
                    console.log('retry ' + device.retry);
                    console.log(error);

                    if (device.retry < MAX_RETRIES) {
                        resolve(this._updateDevice(device));
                    }

                    reject('Max retries exceeded, no success');
                });
        })
    }

    _handleUpdateSequenceTest(device) {
        return new Promise((resolve, reject) => {
            // reject by name
            if (device.getName() === 'Aloe') {
                setTimeout(function () {
                    console.log('_updateDeviceDataPromise reject');
                    reject('some exception');
                }, 500);
            }
            else {
                setTimeout(function () {
                    console.log('_updateDeviceDataPromise resolve');
                    resolve(device);
                }, 500);
            }
        });
    }

    _handleUpdateSequence(device) {
        return new Promise((resolve, reject) => {
            let updateDeviceTime = new Date();

            try {
                this._discover(device).then((device) => {
                    return this._connect(device);
                }).catch(error => {
                    reject(error);
                })
                    .then((device) => {
                        return this._updateDeviceCharacteristicData(device);
                    }).catch(error => {
                    this._disconnect(device);
                    reject(error);
                })
                    .then((device) => {
                        return this._disconnect(device);
                    }).catch(error => {
                    reject(error);
                })
                    .then((device) => {
                        console.log('Device sync complete in: ' + (new Date() - updateDeviceTime) / 1000 + ' seconds');
                        resolve(device);
                    }).catch(error => {
                    reject(error);
                });
            }
            catch (exception) {
                reject(exception);
            }
        });
    }

    _discover(device) {
        console.log('Discover');
        return new Promise((resolve, reject) => {
            try {
                if (device) {
                    if (device.advertisement) {
                        console.log('Already found');
                        resolve(device);
                    }
                    Homey.ManagerBLE.discover().then(function (advertisements) {
                        if (advertisements) {

                            let matched = advertisements.filter(function (advertisement) {
                                return (advertisement.uuid === device.getData().uuid);
                            });

                            if (matched.length === 1) {
                                device.advertisement = matched[0];

                                resolve(device);
                            }
                            else {
                                reject("Cannot find advertisement with uuid " + device.getData().uuid);
                            }
                        }
                        else {
                            reject("Cannot find any advertisements");
                        }
                    });
                }
                else {
                    reject("No device found");
                }
            }
            catch (error) {
                reject(error);
            }
        });
    }

    _connect(device) {
        console.log('Connect');
        return new Promise((resolve, reject) => {
            try {
                device.advertisement.connect((error, peripheral) => {
                    if (error) {
                        reject('failed connection to peripheral: ' + error);
                    }

                    device.peripheral = peripheral;

                    resolve(device);
                });
            }
            catch (error) {
                reject(error);
            }
        })
    }

    _disconnect(device) {
        console.log('Disconnect');
        return new Promise((resolve, reject) => {
            try {
                device.peripheral.disconnect((error, peripheral) => {
                    if (error) {
                        reject('failed connection to peripheral: ' + error);
                    }
                    resolve(device);
                });
            }
            catch (error) {
                reject(error);
            }
        })
    }

    _updateDeviceCharacteristicData(device) {
        return new Promise((resolve, reject) => {
            try {
                const updateCapabilityValue = function (device, index, value) {
                    let currentValue = device.getCapabilityValue(index);

                    // force change if its the save value
                    if (currentValue === value) {
                        device.setCapabilityValue(index, null);
                        device.setCapabilityValue(index, value);
                        device.triggerCapabilityListener(index, value);
                    }
                    else {
                        device.setCapabilityValue(index, value);
                        device.triggerCapabilityListener(index, value);
                    }
                }

                if (device) {
                    console.log('Update :%s', device.getName());
                }
                else {
                    reject('Cannot device anymore');
                }
                device.peripheral.discoverServices((error, services) => {
                    if (error) {
                        reject('failed discoverServices: ' + error);
                    }

                    if (services) {
                        services.forEach(function (service) {
                            service.discoverCharacteristics((error, characteristics) => {
                                if (error) {
                                    reject('failed discoverCharacteristics: ' + error);
                                }

                                if (characteristics) {
                                    characteristics.forEach(function (characteristic) {
                                        switch (characteristic.uuid) {
                                            case DATA_CHARACTERISTIC_UUID:
                                                characteristic.read(function (error, data) {
                                                    if (error) {
                                                        reject('failed to read DATA_CHARACTERISTIC_UUID: ' + error);
                                                    }

                                                    if (data) {
                                                        let checkCharacteristics = [
                                                            "measure_temperature",
                                                            "measure_luminance",
                                                            "measure_conductivity",
                                                            "measure_moisture",
                                                        ];

                                                        let characteristicValues = {
                                                            'measure_temperature': data.readUInt16LE(0) / 10,
                                                            'measure_luminance': data.readUInt32LE(3),
                                                            'measure_conductivity': data.readUInt16LE(8),
                                                            'measure_moisture': data.readUInt16BE(6)
                                                        }

                                                        checkCharacteristics.forEach(function (characteristic) {
                                                            if (characteristicValues.hasOwnProperty(characteristic)) {
                                                                updateCapabilityValue(device, characteristic, characteristicValues[characteristic]);
                                                            }
                                                        });
                                                    }
                                                    else {
                                                        reject('No data found for sensor values.');
                                                    }
                                                })
                                                break
                                            case FIRMWARE_CHARACTERISTIC_UUID:
                                                characteristic.read(function (error, data) {
                                                    if (error) {
                                                        reject('failed to read FIRMWARE_CHARACTERISTIC_UUID: ' + error);
                                                    }
                                                    if (data) {
                                                        let checkCharacteristics = [
                                                            "measure_battery"
                                                        ];

                                                        let characteristicValues = {
                                                            'measure_battery': parseInt(data.toString('hex', 0, 1), 16),
                                                        }

                                                        checkCharacteristics.forEach(function (characteristic) {
                                                            if (characteristicValues.hasOwnProperty(characteristic)) {
                                                                updateCapabilityValue(device, characteristic, characteristicValues[characteristic]);
                                                            }
                                                        });

                                                        let firmwareVersion = data.toString('ascii', 2, data.length);

                                                        device.setSettings({
                                                            firmware_version: firmwareVersion,
                                                            last_updated: new Date().toISOString()
                                                        });

                                                        resolve(device);
                                                    }
                                                    else {
                                                        reject('No data found for firmware.');
                                                    }
                                                });

                                                break;
                                            case REALTIME_CHARACTERISTIC_UUID:
                                                characteristic.write(Buffer.from([0xA0, 0x1F]), false);
                                                break;
                                        }
                                    })
                                }
                                else {
                                    reject('No characteristics found.');
                                }
                            });
                        });
                    }
                    else {
                        reject('No services found.');
                    }
                });
            }
            catch (error) {
                reject(error);
            }
        });
    }
}

module.exports = HomeyMiFlora;