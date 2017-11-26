# Kill any stuck old cockpit processes
kill -9 `ps auxww|grep cockpit.js | grep -v grep | awk '{print $2}'`

# Create log directory
mkdir -p /home/scini/Desktop/logs

# Startup clump camera recording
#mkdir -p /home/scini/Desktop/images/`date +%d%h%H%m`
#mjpg_streamer -i "input_http.so -H 192.168.2.218 -p 8081 -u /bmimg" -o "output_http.so -p 9999 -w /home/scini/Desktop/openrov/www" -o "output_file.so -f /home/scini/Desktop/images/`date +%d%h%H%m`"

# Set the primary forward camera IP here
EXTERNAL_CAM_IP=$1

# Elphel internal temperature URL
TEMP_URL='http://'$EXTERNAL_CAM_IP'/i2c.php?width=8&bus=1&adr=0x4800'

# Attempt to set defaults on camera
# Autoexposure off; JPEG 80% quality; Exposure 30ms
SET_PARAMS_URL='http://'$EXTERNAL_CAM_IP'/parsedit.php?immediate&AUTOEXP_ON=0&QUALITY=80&EXPOS=30000'
curl -v --connect-timeout 5 $SET_PARAMS_URL

# Restart all instances of mqttclient.paho (inittab will respawn)
KILL_URL='http://'$EXTERNAL_CAM_IP'/phpshell.php?command=killall%20mqttclient.pa
ho'
curl -v --connect-timeout 5 $KILL_URL
curl -v --connect-timeout 5 'http://192.168.2.211/phpshell.php?command=killall%20mqttclient.paho'
curl -v --connect-timeout 5 'http://192.168.2.213/phpshell.php?command=killall%20mqttclient.paho'
curl -v --connect-timeout 5 'http://192.168.2.215/phpshell.php?command=killall%20mqttclient.paho'
curl -v --connect-timeout 5 'http://192.168.2.217/phpshell.php?command=killall%20mqttclient.paho'
curl -v --connect-timeout 5 'http://192.168.2.218/phpshell.php?command=killall%20mqttclient.paho'

# Kill any mjpg_streamers hanging around before renice
killall -9 mjpg_streamer

# Always use this in production
USE_MOCK=false EXTERNAL_CAM=true EXTERNAL_CAM_URL='http://'$EXTERNAL_CAM_IP':8081/bmimg' NODE_ENV='production' PLATFORM='scini' BOARD='surface' HARDWARE_MOCK=false DEV_MODE=true cacheDirectory='/tmp/cache' DATADIR='/tmp' LOG_LEVEL='warn' IGNORE_CACHE=true configfile='/tmp/rovconfig.json' pluginsDownloadDiretory='/tmp/plugins' photoDirectory="/tmp" video_url='http://'$EXTERNAL_CAM_IP':8081/bmimg' env plugins__ui-manager__selectedUI='new-ui' node src/cockpit.js  2>&1 | tee -a /home/scini/Desktop/logs/`date +%d%h%H%m`-prod.txt


# Wait 10 seconds and then renice mjpg_streamer to -1
#sleep 10
#sudo -n renice -n -1 -p `ps auxww|grep mjpg_streamer | awk '{print $2}'` && fg %1

