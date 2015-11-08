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

        _verifyTemplateExists:function(templateId){
            if(dust.cache[templateId]===undefined){
                console.log('warning: template ' + templateId + ' does not exist');
            }
        },

        _templateExists:function(templateId){
            return (dust.cache[templateId]!==undefined);
        },

        _render:function(node,templateId,context,callback){
            this._verifyTemplateExists(templateId);
            dust.render(templateId, context, function (err, out) {
                if(out || out===""){
                    node.innerHTML=out;
                }
                if (callback) {
                    callback(err, out);
                }
            });
        },

        _renderTemplate:function(templateId,context,callback){
            this._verifyTemplateExists(templateId);
            dust.render(templateId, context, callback);
        },

        _renderTemplateString:function(str,context,callback){
            var id='template-' + random.str(6);
            this.__precompile(str,id);
            this._renderTemplate(id,context,callback);
        }
    };
}));
