
//umd pattern

(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        //commonjs
        module.exports = factory(require('elliptical-utils'),require('jquery-extensions'),require('./prototype.device'), require('./prototype.template'),
            require('./prototype.transition'), require('./prototype.transform'),require('./prototype.utils'),
            require('./prototype.event'),require('./prototype.options'));
    } else if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(['elliptical-utils','jquery-extensions','./prototype.device',
            './prototype.template','./prototype.transition','./prototype.transform','./prototype.utils','./prototype.event','./prototype.options'], factory);
    } else {
        // Browser globals (root is window)
        var e=root.elliptical.extensions;
        root.elliptical.extensions.base = factory(root.elliptical.utils,root,e.device,
            e.template,e.transition,e.transform,e.utils,e.event,e.options);
        root.returnExports = root.elliptical.extensions.base;
    }
}(this, function (utils,root,device,template,transition,transform,util,event,options) {

    var base={};
    Object.assign(base,util,device,template,transition,transform,event,options);
    return base;

}));