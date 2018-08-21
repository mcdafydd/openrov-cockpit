# OpenROV Elphel-config Plugin

This plugin requires the mqtt-broker plugin.  Upon loading it will join the local MQTT broker and listen for camera control commands from a browser MQTT.js client on the toOrov/camera/# topic tree.  These generic commands are translated into Elphel 353 camera URLs that set the desired parameters.

This plugin also attempts to set camera defaults.  It listens for events from the mqtt-broker to look for Elphel cameras that join.  Upon receiving a join event, it sends a single request to set reasonable defaults:

- 30ms exposure
- Disable auto-exposure

