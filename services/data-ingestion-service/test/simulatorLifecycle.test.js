const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { EventEmitter } = require('node:events');
test('simulator keeps one timer across reconnects and none while offline', () => {
  jest.useFakeTimers();
  try {
    const client = new EventEmitter();
    client.connected = true;
    client.publish = jest.fn();
    const context = {
      require: id => id === 'mqtt' ? { connect: () => client } : id === 'dotenv' ? { config() {} } : id === 'axios' ? {} : require(id),
      module: { exports: {} }, __dirname: '/tmp', process: { env: {} },
      console: { log() {}, error() {} }, setInterval, clearInterval,
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../../simulator/simulator.js'), 'utf8'), context);
    context.module.exports.startDevicePublisher('sim-test', 'secret');
    client.emit('connect');
    client.emit('connect');
    jest.advanceTimersByTime(5000);
    expect(client.publish).toHaveBeenCalledTimes(1);
    client.connected = false;
    client.emit('offline');
    jest.advanceTimersByTime(15000);
    expect(client.publish).toHaveBeenCalledTimes(1);
    client.connected = true;
    client.emit('connect');
    jest.advanceTimersByTime(5000);
    expect(client.publish).toHaveBeenCalledTimes(2);
    client.emit('close');
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});
