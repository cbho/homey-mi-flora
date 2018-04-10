'use strict';

const MiFloraDevice = require('../../lib/MiFloraDevice.js');

class MiFloraPot extends MiFloraDevice {
    getDeviceTriggerCardId() {
        return 'mi_flora_pot';
    }
}

module.exports = MiFloraPot;