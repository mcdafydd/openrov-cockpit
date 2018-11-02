# How to update shrinkwrap/package.json dependency

0. Clone the mjpeg-video-server repo
1. Check 'git log' for the commit hash you want to use
2. Edit the 'git+https' URL in package.json to reflect the new commit hash (just change the hash value nothing else)
3. Run `npm install --save-exact mjpeg-video-server@git+https://github.com/mcdafydd/mjpeg-video-server.git#NEWHASHVALUE`
4. Verify that package.json and npm-shrinkwrap.json both have the new has values for mjpeg-video-server.  If the previous step produced a lot of errors, try deleting the devDependencies block from package JSON and re-run Step 3.
5. Run `npm shrinkwrap --dev` and make sure you don't get any errors.  If you do, see the reference link below
6. If all is good, commit and push the updated package.json and npm-shrinkwrap.json files

# Reference

* https://gist.github.com/alanhogan/a32889830384f4e190fa
