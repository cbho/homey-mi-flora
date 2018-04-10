'use strict';

const Homey = require('homey');

class MiFloraDevice extends Homey.Device {

    onInit() {
        let device = this;
        let capabilities = Homey.app.getCapabilities();
        this.registerMultipleCapabilityListener(capabilities, (valueObj, optsObj) => {
            capabilities.forEach(function (capability) {
                if (valueObj.hasOwnProperty(capability)) {
                    console.log(capability + " changed: %s", valueObj[capability]);
                    Homey.app.triggerCapabilityChange(device, capability, valueObj[capability]);
                }
            })
        });
    }

    getDeviceTriggerCardId() {
        throw new Error('todo: Implement getDeviceTriggerCardId into child class');
    }
}

module.exports = MiFloraDevice;