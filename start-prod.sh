# Set the primary forward camera IP here
EXTERNAL_CAM_IP=$1

# Elphel internal temperature URL
TEMP_URL='http://'$EXTERNAL_CAM_IP'/i2c.php?width=8&bus=1&adr=0x4800'

# Attempt to set defaults on camera
# Autoexposure off; JPEG 80% quality; Exposure 30ms
SET_PARAMS_URL='http://'$EXTERNAL_CAM_IP'/parsedit.php?immediate&AUTOEXP_ON=0&QUALITY=80&EXPOS=30000'
curl $SET_PARAMS_URL

# Kill any mjpg_streamers hanging around before renice
killall -9 mjpg_streamer
sudo -n renice -n -1 -p `sleep 10; ps auxww|grep mjpg_streamer | awk '{print $2}'` &

# Always use this in production
USE_MOCK=false EXTERNAL_CAM=true EXTERNAL_CAM_URL='http://'$EXTERNAL_CAM_IP':8081/bmimg' NODE_ENV='production' PLATFORM='scini' BOARD='surface' HARDWARE_MOCK=false DEV_MODE=true cacheDirectory='/tmp/cache' DATADIR='/tmp' LOG_LEVEL='warn' IGNORE_CACHE=true configfile='/tmp/rovconfig.json' pluginsDownloadDiretory='/tmp/plugins' photoDirectory="/tmp" video_url='http://'$EXTERNAL_CAM_IP':8081/bmimg' env plugins__ui-manager__selectedUI='new-ui' node src/cockpit.js

