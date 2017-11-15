/*jshint multistr: true*/
(function (window, $, undefined) {
  'use strict';
  var Thrusters5x1;
  Thrusters5x1 = function Thrusters5x1(cockpit) {
    console.log('Loading thrusters5x1 plugin in the browser.');
    // Instance variables
    this.cockpit = cockpit;
    this.state = {
      thruster: 0,
      starboard: 0,
      vertical: 0,
      aftvertical: 0,
      aftstarboard: 0
    };
    this.settings = {};  // Add required UI elements
  };
  Thrusters5x1.prototype.loaded = function () {
  };
  Thrusters5x1.prototype.listen = function () {
    var self = this;
    this.cockpit.on('plugin.thrusters5x1.motorTest', function (data) {
      self.sendTestMotorMessage(data);
    });
    this.cockpit.on('plugin.thrusters5x1.set', function (state) {
      self.sendTestMotorMessage(data);
    });
    this.cockpit.rov.withHistory.on('settings-change.thrusters5x1', function (settings) {
      self.settings = settings.thrusters5x1;
    });
  };
  Thrusters5x1.prototype.sendTestMotorMessage = function sendTestMotorMessage(motor_values) {
    this.cockpit.rov.emit('plugin.thrusters5x1.motorTest', motor_values);
  };
  Thrusters5x1.prototype.setMotorTestSpeed = function setMotorTestSpeed(propertyName, value) {
    this[propertyName](value);
  };
  window.Cockpit.plugins.push(Thrusters5x1);
}(window, jQuery));