const {spawn} = require('child_process');

module.exports = function (RED) {
    class Lescan {
        constructor(config) {
            RED.nodes.createNode(this, config);

            this.devices = {};

            this.cmd = config.cmd;
            this.args = ['-i', config.device, 'lescan'];

            if (config.passive) {
                this.args.push('--passive');
            }

            if (config.continuous) {
                this.args.push('--duplicates');
                this.scan();
                this.timeout = config.timeout || 60;
                setInterval(() => {
                    this.checktimeout();
                }, this.timeout * 250);
            } else {
                this.timeout = config.interval * 2;
                this.intervalTimer = setInterval(() => {
                    this.scan();
                    setTimeout(() => {
                        this.stop();
                        this.checktimeout();
                    }, config.scantime * 1000);
                }, config.interval * 1000);
            }

            this.on('close', done => {
                clearInterval(this.intervalTimer);
                this.closePending = true;
                if (this.cp && this.cp.kill) {
                    this.once('done', () => done());
                    this.cp.kill('SIGINT');
                }
            });

        }
        setStatus() {
            if (this.errored) {
                return;
            }
            const numDevices = Object.keys(this.devices).filter(v => this.devices[v].online).length;
            this.status({
                text: numDevices + '/' + Object.keys(this.devices).length,
                fill: this.scanRunning ? 'blue' : 'grey',
                shape: this.scanRunning ? 'dot' : 'ring'
            });
        }
        notify(address) {
            const device = this.devices[address];
            this.debug(address + ' ' + JSON.stringify(device));
            this.send(Object.assign({topic: address, payload: device.online}, device));
            this.setStatus();
        }
        checktimeout() {
            const ts = (new Date()).getTime() - (this.timeout * 1000);
            Object.keys(this.devices).forEach(address => {
                const device = this.devices[address];
                if (device.ts < ts && device.online) {
                    device.online = false;
                    this.notify(address);
                }
            });
        }
        scan() {
            this.debug(this.cmd + ' ' + this.args.join(' '));

            let lineBuffer = '';

            this.cp = spawn(this.cmd, this.args);

            this.cp.on('error', err => {
                this.errored = true;
                this.status({fill: 'red', text: err.message, shape: 'ring'});
                this.error('Failed to start subprocess. ' + err.message);
            });

            this.cp.stdout.on('data', data => {
                this.errored = false;
                if (!this.scanRunning) {
                    this.scanRunning = true;
                    this.setStatus();
                }
                const lines = (lineBuffer + data).split('\n');
                if (data[data.length - 1] !== '\n') {
                    lineBuffer = lines.pop();
                } else {
                    lineBuffer = '';
                }
                this.parse(lines);
            });

            this.cp.stderr.on('data', data => {
                this.error(data.toString());
                this.errored = true;
                this.status({fill: 'red', text: data.toString(), shape: 'ring'});
            });

            this.cp.on('close', (code, signal) => {
                if (this.scanRunning) {
                    this.scanRunning = false;
                    this.setStatus();
                }
                this.debug(`child process exited with code ${code} signal ${signal}`);
                if (this.closePending) {
                    this.emit('done');
                }
            });
        }
        parse(lines) {
            const ts = (new Date()).getTime();
            lines.forEach(line => {
                const match = line.match(/([0-9A-F]{2}:[0-9A-F]{2}:[0-9A-F]{2}:[0-9A-F]{2}:[0-9A-F]{2}:[0-9A-F]{2}) (.*)/);
                if (match) {
                    const [, address, name] = match;
                    if (!this.devices[address]) {
                        this.devices[address] = {};
                    }
                    const device = this.devices[address];
                    device.ts = ts;
                    let nameChange = false;
                    if (!device.name && name !== '(unknown)') {
                        device.name = name;
                        nameChange = true;
                    }
                    if (!device.online || nameChange) {
                        device.online = true;
                        this.notify(address);
                    }
                }
            });
        }
        stop() {
            this.cp.kill('SIGINT');
        }
    }
    RED.nodes.registerType('lescan', Lescan);
};
