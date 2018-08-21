# OpenROV Elphel-config Plugin

This plugin performs the following functions:

0. Joins the local OpenROV MQTT broker and subscribes to the toOrov/camera/# topic tree
1. Sets reasonable defaults on Elphel cameras after they join the broker
2. Listens for MQTT websocket packets published by MQTT.js clients - this allows for simple MJPG streaming viewer clients outside of OpenROV to maintain control of each camera independently
3. Listens for keyboard events from the OpenROV cockpit browser user and translates those into exposure, resolution, JPEG quality, and snapShot functions in the pilot camera

Camera defaults are:
- 30ms exposure
- Disable auto-exposure 
- JPEG quality 90%
- Full sensor resolution
