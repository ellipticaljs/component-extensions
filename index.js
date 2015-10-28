


module.exports=require('jquery-extensions');
module.exports.dust=require('./dist/dust');
module.exports.utils=require('./dist/elliptical.utils');
module.exports.moment=require('moment');
module.exports.mutationSummary=require('./dist/mutation-summary');
module.exports.extensions={
    element:require('./lib/prototype.element'),
    dataStore:require('./lib/prototype.dataStore'),
    device:require('./lib/prototype.device'),
    utils:require('./lib/prototype.utils'),
    drawer:require('./lib/prototype.drawer'),
    navigation:require('./lib/prototype.navigation'),
    transition:require('./lib/prototype.transition'),
    transform:require('./lib/prototype.transform'),
    template:require('./lib/prototype.template'),
    event:require('./lib/prototype.event'),
    base:require('./lib/prototype.base')
};

