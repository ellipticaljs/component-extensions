
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
        root.elliptical.extensions.dataStore = factory();
        root.returnExports = root.elliptical.extensions.dataStore;
    }
}(this, function () {

    return {
        _data:{
            _store:{},
            get:function(prop){
                if(this._store){
                    return this._store[prop];
                }

            },
            set:function(prop,val){
                if(this._store){
                    this._store[prop]=val;
                }
            },
            click:'touchclick',
            hover:'touchhover'
        }
    };
}));