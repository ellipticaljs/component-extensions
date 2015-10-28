
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
        root.elliptical=root.elliptical || {};
        root.elliptical.extensions=root.elliptical.extensions || {};
        root.elliptical.extensions.transition = factory();
        root.returnExports = root.elliptical.extensions.transition;
    }
}(this, function () {

    return {

        _transition: function (element, options, callback) {
            $.transition=$.transition || $.transit;
            if (!(element instanceof jQuery)) element=$(element);
            options = options || {};
            if (options === {}) {
                options.duration = 300;
                options.preset = 'fadeIn';
            }
            if(options.preset==='none'){
                element.hide();
                return;
            }
            element.transition(options, function () {
                if (callback) {
                    callback.call(element[ 0 ]);
                }
            });
        }
    };
}));