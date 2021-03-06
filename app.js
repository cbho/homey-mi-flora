'use strict';

const Homey = require('homey');

const APP_VERSION = 'v1.0.1';

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

    _updateDevices(devices) {
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

    getDevices(identification, name) {
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
}

module.exports = HomeyMiFlora;