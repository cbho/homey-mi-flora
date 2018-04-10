'use strict';

const MiFloraDevice = require('../../lib/MiFloraDevice.js');

class MiFloraSensor extends MiFloraDevice {
    getDeviceTriggerCardId() {
        return 'mi_flora_sensor';
    }
}

module.exports = MiFloraSensor;