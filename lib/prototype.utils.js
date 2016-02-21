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
        root.elliptical.extensions.utils = factory();
        root.returnExports = root.elliptical.extensions.utils;
    }
}(this, function () {

    return {

        _utils: $.utils,

        _DOMParser: function (htmlString) {
            return new DOMParser().parseFromString(htmlString, 'text/html');
        },

        _preloadImages: function (element, callback) {
            var imgArray = [];
            var err = {};
            var data = {};
            var images = element.find('img').not('[data-src]');
            var length = images.length;
            var counter = 0;
            if (length === 0) {
                if (callback) {
                    err.message = 'No images found in element';
                    callback(err, null);
                }
                return false;
            }
            $.each(images, function (i, img) {
                var image = new Image();
                $(image).bind('load', function (event) {
                    counter++;
                    imgArray.push(image);
                    if (counter === length) {
                        if (!callback) {
                        } else {
                            data.images = imgArray;
                            data.length = counter;
                            callback(null, data);
                        }
                    }
                });
                image.src = img.src;
            });
            return true;
        },

        _scrollTop: function (ypos, evt) {
            if (typeof ypos !== "number") {
                ypos = 0;
            } else if (typeof evt === 'undefined') {
                evt = 'scrollTop';
            }

            setTimeout(function () {
                window.scrollTo(0, ypos);
                $(document).trigger(evt, {x: 0, y: ypos});
            }, 20);
        },

        _setModal: function (element, opts, callback) {
            //support 0-3 params
            var length = arguments.length;
            if (length === 0) {
                element = $('body');
                opts = {};
                callback = null;
            } else if (length === 1) {
                if (typeof element === 'function') {
                    callback = element;
                    element = $('body');
                    opts = {};
                } else if (element.context) {
                    opts = {};
                    callback = null;
                } else {
                    opts = element;
                    element = $('body');
                }
            } else if (length === 2) {
                if (typeof opts === 'function') {
                    callback = opts;
                    if (element.context === undefined) {
                        opts = element;
                        element = $('body');
                    } else {
                        opts = {};
                    }
                } else {
                    callback = null;
                }
            }

            var div = $('<div class="ui-modal"></div>');
            if (opts.cssClass) {
                div.addClass(opts.cssClass);
            }

            if (opts.zIndex) {
                div.css({
                    'z-index': opts.zIndex
                });
            }
            if(opts.background){
                div.css({
                    background: opts.background
                });
            }
            if (this._data) {
                this._data.set('modal', div);
            } else {
                this._modal = div;
            }

            var opacity = (opts.opacity !==undefined) ? opts.opacity : .3;
            div.css({
                opacity: 0
            });
            element.append(div);

            this._transition(div, {
                opacity: opacity,
                duration: 250
            }, function () {
                if (callback) {
                    callback();
                }
            });
        },

        _removeModal: function (callback) {
            var self = this;
            var modal = null;
            if (this._data) {
                modal = this._data.get('modal');
            } else {
                modal = this._modal;
            }

            if (!modal || modal === undefined) {
                return;
            }
            this._transition(modal, {
                opacity: 0,
                duration: 250
            }, function () {
                modal.remove();
                (self._data) ? self._data.set('modal', null) : self._modal = null;
                if (callback) {
                    callback();
                }
            });
        },


        _resetSemanticState:function(){
            this.element.removeClass('error')
                .removeClass('warning')
                .removeClass('success')
                .removeClass('info')
        },

        _setChildrenAttributes:function(){
            var element=this.element;
            if(element[0].hasAttribute && element[0].hasAttribute('disabled')){
                element.query('input,textarea,select',function(result){
                    if(result[0]){
                        result.attr('disabled',true);
                    }
                });
            }
            if(element[0].hasAttribute && element[0].hasAttribute('readonly')){
                element.query('input,textarea,select',function(result){
                    if(result[0]){
                        result.attr('readonly',true);
                    }
                });
            }
        },

        _enableChildrenAttributes:function(){
            var element=this.element;
            element.query('input,textarea,select',function(result){
                if(result[0]){
                    result.attr('disabled',false);
                }
            });
            element.query('input,textarea,select',function(result){
                if(result[0]){
                    result.attr('readonly',false);
                }
            });
        },

        _find:function(selector){
            return this.element.find(selector);
        },

        _jsonParseMessage: function (obj) {
            try {
                var msgObj = JSON.parse(obj);
                if (msgObj.message) {
                    return msgObj.message;
                } else {
                    return obj;
                }
            } catch (ex) {
                return obj;
            }
        }


    };
}));