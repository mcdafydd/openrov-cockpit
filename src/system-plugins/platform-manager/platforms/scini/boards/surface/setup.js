const Promise       = require( 'bluebird' );
const fs            = Promise.promisifyAll( require('fs') );
const path          = require('path');
const spawn         = require('child_process').spawn;
const Bridge        = require('./bridge.js');

var Periodic        = require( 'Periodic' );
var logger          = require('AppFramework.js').logger;

var debug = {};

var SetupBoardInterface = function(board) 
{
    logger.debug( "Creating bridge" );

    // Decorate the MCU interface with board specific properties
    // board.physics         = new ArduinoHelper().physics;
    board.bridge = new Bridge('127.0.0.1');

    board.statusdata = {};

    logger.debug( "Setting up bridge" );

    // ------------------------------------------------
    // Setup private board methods
    // ------------------------------------------------

    board.updateSetting = function () 
    {
      // This is the multiplier used to make the motor act linear fashion.
      // For example: the props generate twice the thrust in the positive direction than the negative direction.
      // To make it linear we have to multiply the negative direction * 2.
      var command = 'updateSetting('
        + board.vehicleConfig.preferences.get('smoothingIncrement') + ',' 
        + board.vehicleConfig.preferences.get('deadzone_neg') + ',' 
        + board.vehicleConfig.preferences.get('deadzone_pos') + ');';
  
      board.bridge.write(command);
    };

    // Setup bridge interface event handlers
    board.bridge.on('serial-received', function(data) 
    {
        board.global.emit(board.interface + '.serialReceived', data);
    });

    board.bridge.on('status', function(status) 
    {
      // Some of these functions were copied from the beaglebone 2x board setup.js file

      // Clear old status data
      board.statusdata = {};
    
      // Copy new status data 
      for (var i in status) 
      {
        board.statusdata[i] = status[i];
      }
  
      // Re-emit status data for other subsystems
      board.global.emit(board.interface + '.status', board.statusdata);

      // Re-emit status data for other subsystems
      board.global.emit( board.interface + '.status', status );

      // Settings update   
      if ('TSET' in status) 
      {
        var setparts = status.settings.split(',');
        board.settingsCollection.smoothingIncriment = setparts[0];
        board.settingsCollection.deadZone_min = setparts[1];
        board.settingsCollection.deadZone_max = setparts[2];
        board.global.emit(board.interface + '.firmwareSettingsReported', board.settingsCollection);
      }
  
      // Command request
      if ('cmd' in status) 
      {
        // Re-emit all commands except ping
        if (status.com != 'ping(0)') 
        {
          board.global.emit(board.interface + '.command', status.cmd);
        }
      }
  
      // Log entry
      if ('log' in status)
      {
      }
  
      // Initial boot notification
      if ('boot' in status) 
      {
        board.updateSetting();
        board.requestSettings();
      }

    });

    logger.debug( "Setting up API" );

    // ------------------------------------------------
    // Setup Public API	
    RegisterFunctions(board);
    
    // Call initialization routine
    board.global.emit('mcu.Initialize');

    logger.debug( "Setting up statemachine" );

    // Create and start statemachine
    board.fsm = require( './statemachine.js' )( board );
    board.fsm._e_init();

    logger.debug( "Done" );
};

// ------------------------------------------------
// Public API Definitions	
// ------------------------------------------------
var RegisterFunctions = function(board) 
{
   board.AddMethod('Initialize', function () 
  {
    logger.debug('MCU Interface initialized!');

    // TODO: Only allow the statemachine to do this
    // Turn on the serial
    board.global.emit('mcu.StartSerial');
  }, false);

  board.AddMethod('ResetMCU', function (path) 
  {
    // Trigger an MCU reset
    // This function should be removed or rewritten to be useful in SCINI since MCU runs on a laptop on the surface
    board.fsm._e_trigger_mcu_reset_user();
  }, false);

  board.AddMethod('SendCommand', function( command ) 
  {
    board.bridge.write( command + ';' );
  }, false);

  // Forward cockpit commands to the global bus to be sent to the firmware
  board.cockpit.on("mcu.SendCommand",function( commandIn )
  {
    board.global.emit("mcu.SendCommand", commandIn );
  });

  board.AddMethod('RegisterPassthrough', function (config) 
  {
    if(config) 
    {
      if (!config.messagePrefix) 
      {
        throw new Error('You need to specify a messagePrefix that is used to emit and receive message.');
      }

      var messagePrefix = config.messagePrefix;

      // Route specific status messages from the firmware to plugins interested in them
      if (config.fromROV) 
      {
        if (Array.isArray(config.fromROV)) 
        {
          config.fromROV.forEach(function (item) 
          {
            // Register listener to forward from MCU to Cockpit
            board.global.on(board.interface + '.status', function (data) 
            {
              if (item in data) 
              {
                board.cockpit.emit(messagePrefix + '.' + item, data[item]);
              }
            });
          });
        } 
        else 
        {
          throw new Error('config.fromROV needs to be an array.');
        }
      }

      // Route commands to the bridge
      if (config.toROV) 
      {
        if (Array.isArray(config.toROV)) 
        {
          config.toROV.forEach(function (item) 
          {
            // Register listener to forward from cockpit to MCU
            board.cockpit.on(messagePrefix + '.' + item, function (data) 
            {
              var args = Array.isArray(data) ? data.join() : data;
              var command = item + '(' + args + ')';
              board.send(command);
            });
          });
        } 
        else 
        {
          throw new Error('config.toROV needs to be an array.');
        }
      }
    }
  }, false);

  board.AddMethod('StartSerial', function () 
  {
    // Connect to the MCU
    logger.debug( "StartSerial" );
    board.bridge.connect();
  }, false);

  board.AddMethod('StopSerial', function () 
  {
    // Close the bridge connection
    board.bridge.close();
  }, false);

  board.AddMethod('StartRawSerial', function () 
  {
    board.bridge.startRawSerialData();
  }, false);

  board.AddMethod('StopRawSerial', function () 
  {
    board.bridge.stopRawSerialData();
  }, false);
};

module.exports = SetupBoardInterface;
