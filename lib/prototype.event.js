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
            var tagName=this.tagName.toLowerCase();
            var nameSpacedTagName = this._utils.string.tagNameToNamespace(tagName);
            evt=nameSpacedTagName + '.' + evt;
            this.element.trigger(evt,data);
        },

        _dispatchEvent:function(evt,data){
            var event=new CustomEvent(evt,{detail:data});
            document.dispatchEvent(event);
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