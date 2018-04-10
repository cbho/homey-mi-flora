"use strict";

const MiFloraDriver = require('../../lib/MiFloraDriver.js');

class MiFloraPotDriver extends MiFloraDriver {
    getMiFloraBleIdentification() {
        return 'ropot';
    }

    getMiFloraBleName() {
        return 'Mi Flora Ropot';
    }
}

module.exports = MiFloraPotDriver;