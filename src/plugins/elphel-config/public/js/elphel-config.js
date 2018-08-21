(function(window)
{
    'use strict';
    class ElphelConfig
    {
        constructor( cockpit )
        {
            console.log('ElphelConfig Plugin running');

            var self = this;
            self.cockpit = cockpit;

            self.settings = null;     // These get sent by the local model

            //Set up actions associated with this plugin
            this.actions =
            {
                "plugin.elphel-config.resolutionFull":
                {
                    description: "Set Elphel pilot camera to full resolution",
                    controls:
                    {
                        button:
                        {
                            down: function() {
                                this.cockpit.rov.emit( 'plugin.elphel-config.resolution', 1 );
                            }
                        }
                    }
                },
                "plugin.elphel-config.resolutionHalf":
                {
                    description: "Set Elphel pilot camera to half resolution",
                    controls:
                    {
                        button:
                        {
                            down: function() {
                                this.cockpit.rov.emit( 'plugin.elphel-config.resolution', 2 );
                            }
                        }
                    }
                },
                "plugin.elphel-config.resolutionQuarter":
                {
                    description: "Set Elphel pilot camera to quarter resolution",
                    controls:
                    {
                        button:
                        {
                            down: function() {
                                this.cockpit.rov.emit( 'plugin.elphel-config.resolution', 4 );
                            }
                        }
                    }
                },
                "plugin.elphel-config.quality70":
                {
                    description: "Take full resolution snapshot",
                    controls:
                    {
                        button:
                        {
                            down: function() {
                                this.cockpit.rov.emit( 'plugin.elphel-config.quality', 70 );
                            }
                        }
                    }
                },
                "plugin.elphel-config.quality80":
                {
                    description: "Take full resolution snapshot",
                    controls:
                    {
                        button:
                        {
                            down: function() {
                                this.cockpit.rov.emit( 'plugin.elphel-config.quality', 80 );
                            }
                        }
                    }
                },
                "plugin.elphel-config.quality90":
                {
                    description: "Take full resolution snapshot",
                    controls:
                    {
                        button:
                        {
                            down: function() {
                                this.cockpit.rov.emit( 'plugin.elphel-config.quality', 90 );
                            }
                        }
                    }
                },
                "plugin.elphel-config.quality100":
                {
                    description: "Take full resolution snapshot",
                    controls:
                    {
                        button:
                        {
                            down: function() {
                                this.cockpit.rov.emit( 'plugin.elphel-config.quality', 100 );
                            }
                        }
                    }
                },
                "plugin.elphel-config.exposureAdd":
                {
                    description: "Increase exposure",
                    controls:
                    {
                        button:
                        {
                            down: function() {
                                this.cockpit.rov.emit( 'plugin.elphel-config.exposure', 1 );
                            }
                        }
                    }
                },
                "plugin.elphel-config.exposureSubtract":
                {
                    description: "Decrease exposure",
                    controls:
                    {
                        button:
                        {
                            down: function() {
                                this.cockpit.rov.emit( 'plugin.elphel-config.exposure', -1 );
                            }
                        }
                    }
                },
                "plugin.elphel-config.snapFull":
                {
                    description: "Take full resolution snapshot",
                    controls:
                    {
                        button:
                        {
                            down: function() {
                                this.cockpit.rov.emit( 'plugin.elphel-config.snapFull' );
                            }
                        }
                    }
                }
            };

            // Setup input handlers
            this.inputDefaults =
            {
                keyboard:
                {
                    "shift+1": { type: "button",
                               action: "plugin.elphel-config.resolutionFull"},
                    "shift+2": { type: "button",
                               action: "plugin.elphel-config.resolutionHalf"},
                    "shift+4": { type: "button",
                               action: "plugin.elphel-config.resolutionQuarter"},
                    "shift+7": { type: "button",
                               action: "plugin.elphel-config.quality70"},
                    "shift+8": { type: "button",
                               action: "plugin.elphel-config.quality80"},
                    "shift+9": { type: "button",
                               action: "plugin.elphel-config.quality90"},
                    "shift+0": { type: "button",
                               action: "plugin.elphel-config.quality100"},
                    "+":       { type: "button",
                               action: "plugin.elphel-config.exposureAdd"},
                    "_":       { type: "button",
                               action: "plugin.elphel-config.exposureSubtract"},
                    "space":   { type: "button",
                               action: "plugin.elphel-config.snapFull"}
                }
            };
        };

        sayHello()
        {
          // Send the sayHello command to the node plugin
          this.cockpit.rov.emit( 'plugin.elphel-config.sayHello' );
        }

        getTelemetryDefinitions()
        {
            return [{
                name: 'elphel-config.message',
                description: 'The message sent from the elphel-config module in the MCU'
            }]
        };

        // This pattern will hook events in the cockpit and pull them all back
        // so that the reference to this instance is available for further processing
        listen()
        {
            var self = this;

            // Listen for settings from the node plugin
            this.cockpit.rov.withHistory.on('plugin.elphel-config.settingsChange', function(settings)
            {
                // Copy settings
                self.settings = settings;

                // Re-emit on cockpit
                self.cockpit.emit( 'plugin.elphel-config.settingsChange', settings );
            });

            // Listen for response messages from the Node plugin
            this.cockpit.rov.withHistory.on('plugin.elphel-config.message', function( message )
            {
                // Log the message!
                console.log( "ElphelConfig Plugin says: " + message );

                // Rebroadcast for other plugins and widgets in the browser
                self.cockpit.emit( 'plugin.elphel-config.message', message );
            });

            // Listen for sayHello requests from other plugins and widgets
            /*this.cockpit.on('plugin.elphel-config.sayHello', function()
            {
                self.sayHello();
            });*/
        };
    };

    // Add plugin to the window object and add it to the plugins list
    var plugins = namespace('plugins');
    plugins.ElphelConfig = ElphelConfig;
    window.Cockpit.plugins.push( plugins.ElphelConfig );

}(window));