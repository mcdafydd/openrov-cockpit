/*
  Running this within a function prevents leaking variables
  in to the global namespace.
*/
(function (window) {
  'use strict';
  var widgets = namespace('widgets');
  widgets['elphel-config'] = {
    name: 'elphel-config',
    defaultUISymantic: 'multipurpose-display',
    url: 'elphel-config/elphel-config.html'
  };
}  // The line below both ends the anonymous function and then calls
   // it passing in the required depenencies.
(window));
