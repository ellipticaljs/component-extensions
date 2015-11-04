
//umd pattern

(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        //commonjs
        module.exports = factory(require('elliptical-utils'),require('jquery-extensions'),require('./element'),
            require('./dataStore'),require('./device'), require('./template'),
            require('./transition'), require('./transform'),require('./utils'),require('./event'));
    } else if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(['elliptical-utils','jquery-extensions','./prototype.element','./prototype.dataStore','./prototype.device',
            './prototype.template','./prototype.transition','./prototype.transform','./prototype.utils','./prototype.event'], factory);
    } else {
        // Browser globals (root is window)
        var e=root.elliptical.extensions;
        root.elliptical.extensions.base = factory(root.elliptical.utils,root,e.element,e.dataStore,e.device,
            e.template,e.transition,e.transform,e.utils,e.event);
        root.returnExports = root.elliptical.extensions.base;
    }
}(this, function (utils,root,element,dataStore,device,template,transition,transform,util,event) {

    var base={};
    Object.assign({},element,dataStore,util,device,template,transition,transform,event);
    return base;

}));