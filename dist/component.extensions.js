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
        root.elliptical.extensions.element = factory();
        root.returnExports = root.elliptical.extensions.element;
    }
}(this, function () {

    return {
        created:function(){
            this.element=$(this);
        }

    };
}));

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
        root.elliptical.extensions.utils = factory();
        root.returnExports = root.elliptical.extensions.utils;
    }
}(this, function () {

    return {

        _utils:$.utils,

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
            if (this._data) {
                this._data.set('modal', div);
            } else {
                this._modal = div;
            }

            var opacity = (opts.opacity) ? opts.opacity : .3;
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
        }


    };
}));

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
            }
        }
    };
}));
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
        root.elliptical.extensions = root.elliptical.extensions | {};
        root.elliptical.extensions.device = factory();
        root.returnExports = elliptical.extensions.device;
    }
}(this, function () {

    return {

        _device: $.device,
        _mq: $.mq,

        _press: function () {
            return ('ontouchend' in document) ? 'touchstart' : 'click';
        },

        _mode: function () {
            return (this._device.viewport.width > 768) ? "desktop" : "touch";
        }

    };
}));


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
        root.elliptical.extensions=root.elliptical.extensions | {};
        root.elliptical.extensions.drawer = factory();
        root.returnExports=elliptical.extensions.drawer;
    }
}(this, function () {

    return {
        /**
         * create a drawer container
         * @param element {Object}
         * @param dataClass {String}
         * @private
         */
        _createDrawer: function (element, dataClass) {
            //prevent multiple drawers
            if(this._data.get('locked')){
                return;
            }
            this._data.set('locked',true);
            //get reference to the container
            var container=$('ui-container');
            this._data.set('container',container);

            //get ref to the toggle container
            var transformContainer = container.parent();
            this._data.set('transformContainer',transformContainer);

            //create the drawer elements
            var drawer=$('<touch-ui-drawer></touch-ui-drawer>');
            if (dataClass) {
                drawer.addClass(dataClass);
            }
            var height = this._device.viewport.height;

            drawer.css({
                'min-height': height + 'px'
            });
            if(!this._device.touch){
                drawer.css({
                    'position': 'relative'
                });
            }
            var drawerHeader = $('<header></header>');

            //append header to drawer
            drawer.append(drawerHeader);

            var drawerSection = $('<section></section>');
            drawer.append(drawerSection);

            //insert drawer into the DOM
            container.before(drawer);

            //save references
            this._data.set('drawer',drawer);
            this._data.set('drawerHeader',drawerHeader);
            this._data.set('drawerSection',drawerSection);
        },

        /**
         * open the drawer
         * @param callback {function}
         * @param fnClose {function}
         * @private
         */
        _openDrawer: function (callback, fnClose) {

            //show drawer
            this._showDrawer();


            //get viewport height
            var height = this._device.viewport.height;
            if(this.options) this.options.height=height;
            else{
                this.height = height;
            }

            var self = this;

            //get ref to containers
            var container = this._data.get('container');
            var transformContainer = this._data.get('transformContainer');

            //hardware accelerate the transition
            this._setHardwareAcceleration(transformContainer);

            //container overflow
            //this._setContainerOverflow(transformContainer);

            //set container to viewport height and add component classes
            container
                .addClass('ui-fixed-toggle-container')
                .css({
                    height: height + 'px'
                })
                .addClass('ui-drawer-box-shadow');


            //append overlay to container
            var overlay = $('<ui-overlay></ui-overlay>');
            overlay.addClass('show');
            container.append(overlay);

            //save ref to overlay
            this._data.set('overlay',overlay);

            var overlayBackground=(this.options) ? this.options.overlayBackground : this.overlayBackground;
            var overlayOpacity=(this.options) ? this.options.overlayOpacity : this.overlayOpacity;
            var overlayOpenDuration=(this.options) ? this.options.overlayOpenDuration : this.overlayOpenDuration;
            var transformDuration=(this.options) ? this.options.transformDuration : this.transformDuration;
            var transformDelay=(this.options) ? this.options.transformDelay : this.transformDelay;
            var translateX=(this.options) ? this.options.translateX : this.translateX;

            overlay.transition({
                background: overlayBackground,
                opacity: overlayOpacity,
                duration: overlayOpenDuration

            });

            //transition container
            var opts = {};
            opts.duration = transformDuration;
            opts.delay = transformDelay;
            opts.easing = 'ease-in-out';
            var coordinates = {};
            coordinates.x = translateX;
            coordinates.y = 0;
            coordinates.z = 0;
            opts.coordinates = coordinates;
            opts.transitionEnd = true;

            /* click special event name */
            var click=this._data.click;
            var closeEvent=this._closeDrawer.bind(this);
            this.element.trigger('drawer.open',{open:true,closeEvent:closeEvent});
            this._3dTransition(container, opts, function () {
                self._resetHardwareAcceleration(transformContainer);
                self._resetTransition($(this));

                if (callback) {
                    callback();
                }
            });

            overlay.on(click, function () {
                if (fnClose) {
                    fnClose();
                }
            });


        },

        /**
         * close the drawer
         * @param callback
         * @private
         */
        _closeDrawer: function (callback) {
            var height=(this.options) ? this.options.height : this.height;
            //get container ref
            var container = this._data.get('container');
            var scrollTop=window.scrollY;
            /* if drawer has been vertically scrolled, we need to add scrollY to
             the fixed toggle container height(=viewport height when opened) on close
             to avoid revealing underneath content at scrollY.
             */
            if(scrollTop > 0){
                height+=scrollTop;
                container.css({
                    height:height + 'px'
                });

                /* additionally, to avoid navbar/topbar and drawer header dsiappearing from viewport on drawer close, we
                 need to assign top=scrollTop on those elements during the duration of the close animation
                 */
                this.element.css({
                    top:scrollTop + 'px'
                });

                var drawerHeader=this._data.get('drawerHeader');
                drawerHeader.css({
                    top:scrollTop + 'px'
                })
            }

            var transformContainer = this._data.get('transformContainer');
            var overlayBackground=(this.options) ? this.options.overlayBackground : this.overlayBackground;
            var overlayCloseDuration=(this.options) ? this.options.overlayCloseDuration : this.overlayCloseDuration;
            var transformDuration=(this.options) ? this.options.transformDuration : this.transformDuration;
            var transformDelay=(this.options) ? this.options.transformDelay : this.transformDelay;

            //get overlay ref
            var overlay = this._data.get('overlay');

            var self = this;
            //hardware accelerate the transition
            this._setHardwareAcceleration(transformContainer);

            var opts = {};
            opts.duration = transformDuration;
            opts.delay = transformDelay;
            opts.easing = 'ease-in-out';
            var coordinates = {};
            coordinates.x = 0;
            coordinates.y = 0;
            coordinates.z = 0;
            opts.coordinates = coordinates;
            opts.transitionEnd = true;
            this.element.trigger('drawer.close',{open:false});
            this._3dTransition(container, opts, function () {
                self._resetHardwareAcceleration(transformContainer);
                self._resetContainer(container);
                self._hideDrawer();

                if (callback) {
                    callback();
                }
            });

            /* click special event name */
            var click=this._data.click;

            overlay.off(click);

            overlay.transition({
                background: overlayBackground,
                opacity: 0,
                duration: overlayCloseDuration
            }, function () {
                overlay.remove();

            });

        },

        /**
         * show the drawer
         * @private
         */
        _showDrawer: function () {
            var height = this._device.viewport.height;
            var drawer=this._data.get('drawer');
            drawer.css({
                'min-height': height + 'px',
                'display':'block'
            });


        },

        /**
         * hide the drawer
         * @private
         */
        _hideDrawer: function () {
            var drawerHeader=this._data.get('drawerHeader');
            drawerHeader.css({
                top:''
            });
            var drawer=this._data.get('drawer');
            drawer.hide();
        },

        /**
         * remove the drawer
         * @private
         */
        _removeDrawer: function () {
            var drawer=this._data.get('drawer');
            if(drawer){
                drawer.remove();
                this._data.set('drawer',null);
            }
            this._data.set('locked',false);
            var container = this._data.get('container');
            this._resetContainer(container);
            var overlay = this._data.get('overlay');
            if (overlay) {
                overlay.remove();
            }
            var transformContainer = this._data.get('transformContainer');
            this._resetHardwareAcceleration(transformContainer);

        },


        /*==========================================
         PUBLIC METHODS
         *===========================================*/

        /**
         *  @public
         */
        showDrawer: function () {
            this._showDrawer();
        },

        /**
         *
         * @public
         */
        hideDrawer: function () {
            this._hideDrawer();
        }


    };
}));

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
        root.elliptical.extensions.transform = factory();
        root.returnExports = root.elliptical.extensions.transform;
    }
}(this, function () {
    var provider = $.transforms;
    var HARDWARE_ACCELERATED_CLASS='ui-hardware-accelerated';
    var OVERFLOW_CONTAINER_CLASS='ui-overflow-container';
    var FIXED_TOGGLE_CONTAINER_CLASS='ui-fixed-toggle-container';
    var BOX_SHADOW_CLASS='ui-drawer-box-shadow';

    return {

        _setHardwareAcceleration: function (element) {
            this._data.set('toggleAcceleration', provider.setHardwareAcceleration(element, HARDWARE_ACCELERATED_CLASS));
        },

        _resetHardwareAcceleration: function (element) {
            provider.resetHardwareAcceleration(element, this._data.get('toggleAcceleration'), HARDWARE_ACCELERATED_CLASS);
        },

        _setContainerOverflow: function (element) {
            this._data.set('toggleOverflow', provider.setContainerOverflow(element, OVERFLOW_CONTAINER_CLASS));
        },

        _resetContainerOverflow: function (element) {
            provider.resetContainerOverflow(element, OVERFLOW_CONTAINER_CLASS);
        },

        _resetContainer: function (container) {
            provider.resetContainer(container, BOX_SHADOW_CLASS, FIXED_TOGGLE_CONTAINER_CLASS);
        },

        _resetTransition: function (element) {
            provider.resetTransition(element);
        },

        _resetTransform: function (element) {
            provider.resetTransform(element);
        },

        _transform: function (element, coordinates) {
            provider.transform(element, coordinates);
        },

        _3dTransition: function (element, opts, callback) {
            provider.transition3d(element, opts, callback);
        }

    };
}));
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
        root.elliptical.extensions.template = factory(root.elliptical.utils,root.dust);
        root.returnExports = root.elliptical.extensions.template;
    }
}(this, function (utils,dust) {
    var random=utils.random;

    return {

        __precompile:function(template,id){
            template = template.replace(/&quot;/g,'"');
            var compiled=dust.compile(template,id);
            dust.loadSource(compiled);
        },

        _precompileTemplate:function(node,templateId){
            var html=node.innerHTML;
            this.__precompile(html,templateId);
        },

        _render:function(node,templateId,context,callback){
            dust.render(templateId, context, function (err, out) {
                if(out){
                    node.innerHTML=out;
                }
                if (callback) {
                    callback(err, html);
                }
            });
        },

        _renderTemplate:function(templateId,context,callback){
            dust.render(templateId, context, callback);
        },

        _renderTemplateString:function(str,context,callback){
            var id='template-' + random.str(6);
            this.__precompile(str,id);
            this._renderTemplate(id,context,callback);
        }
    };
}));

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
        root.elliptical.extensions.event = factory();
        root.returnExports = root.elliptical.extensions.event;
    }
}(this, function () {

    return {

        _onEventTrigger: function (evt, data) {
            this._triggerEvent(evt, data);
        },

        _triggerEvent: function (evt, data) {
            var event = $.Event(evt);
            this._trigger(evt, event, data);
        },

        _trigger: function (type, event, data) {
            if(this.options){
                this._jqTrigger(type,event,data);
            }else{
                this.__triggerEvent(type,data);
            }
        },

        __triggerEvent:function(evt,data){
            var nameSpacedTagName = this._utils.string.tagNameToNamespace(tagName);
            evt=nameSpacedTagName + '.' + evt;
            this.element.trigger(evt,data);
        },

        _jqTrigger:function(type,event,data){
            try {
                var prop, orig,
                    callback = this.options[type];

                data = data || {};
                var prefix = this.widgetEventPrefix;
                var tagName = this.bindings[0].tagName.toLowerCase();
                var tagArray = tagName.split('-');
                var tagLength = tagArray.length;
                var nameSpacedTagName = this._utils.string.tagNameToNamespace(tagName);
                var arr = prefix.toArrayFromCamelCase();
                var nameSpacedPrefix = this._utils.array.toNamespaceFromArray(arr);
                if (nameSpacedPrefix === nameSpacedTagName) {
                    prefix = nameSpacedPrefix;
                } else if (tagLength > 1) {
                    prefix = nameSpacedTagName + '.' + prefix;
                } else {
                    prefix = this.namespace + '.' + prefix;
                }

                event = $.Event(event);
                event.type = ( type === prefix ?
                    type :
                prefix + '.' + type ).toLowerCase();
                // the original event may come from any element
                // so we need to reset the target on the new event
                event.target = this.element[0];

                // copy original event properties over to the new event
                orig = event.originalEvent;
                if (orig) {
                    for (prop in orig) {
                        if (!( prop in event )) {
                            event[prop] = orig[prop];
                        }
                    }
                }

                this.element.trigger(event, data);
                return !( $.isFunction(callback) &&
                callback.apply(this.element[0], [event].concat(data)) === false ||
                event.isDefaultPrevented() );
            } catch (ex) {

            }
        }

    };
}));

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
        var e=root.elliptical.prototype.extensions;
        root.elliptical.extensions.mixin = factory(root.elliptical.utils,root,e.element,e.dataStore,e.device,
            e.template,e.transition,e.transform,e.utils,e.event);
        root.returnExports = root.elliptical.extensions.mixin;
    }
}(this, function (utils,root,element,dataStore,device,template,transition,transform,util,event) {

    return Object.assign({},element,dataStore,util,device,template,transition,transform,event);

}));