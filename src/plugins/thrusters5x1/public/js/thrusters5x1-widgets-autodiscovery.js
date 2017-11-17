/*
  Running this within a function prevents leaking variables
  in to the global namespace.
*/
(function (window) {
  'use strict';
  var widgets = namespace('widgets');
  widgets['orov-thrusters5x1-motortest'] = {
    name: 'orov-thrusters5x1-motortest',
    defaultUISymantic: 'multipurpose-display',
    url: 'thrusters5x1/orov-thrusters5x1-motortest.html'
  };
}  // The line below both ends the anonymous function and then calls
   // it passing in the required depenencies.
(window));