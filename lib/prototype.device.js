//umd pattern

(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        //commonjs
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([], factory);
    } else {
        // Browser globals (root is window)
        root.elliptical = root.elliptical || {};
        root.elliptical.extensions = root.elliptical.extensions || {};
        root.elliptical.extensions.device = factory();
        root.returnExports = elliptical.extensions.device;
    }
}(this, function () {

    return {

        _device: $.device,
        _mq: $.device.mq,

        _press: function () {
            return ('ontouchend' in document) ? 'touchstart' : 'click';
        },

        _mode: function () {
            return (this._device.viewport.width > 768) ? "desktop" : "touch";
        }

    };
}));
