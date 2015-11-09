var gulp=require('gulp'),
    fs = require('fs-extra'),
    concat=require('gulp-concat'),
    uglify = require('gulp-uglify'),
    BUILD_JSON=require('./build.json'),
    BUILD_NAME='component.extensions.js',
    MIN_NAME='component.extensions.min.js',
    REPO_NAME='component extensions',
    DIST='./dist',
    DUST='./node_modules/dustjs/dist/dust.js',
    DUSTH=['./node_modules/dustjs-helpers/dist/dust-helpers.js','./lib/dust-helpers.js'],
    JQ='./node_modules/jquery-extensions/dist/jquery.js',
    JQEXT='./node_modules/jquery-extensions/dist/jquery.extensions.js',
    MS='./node_modules/jquery-mutation-summary/dist/mutation.summary.js',
    UTILS='./node_modules/elliptical-utils/dist/elliptical.utils.js',
    MOMENT='./node_modules/moment/moment.js',
    CSS='./css/styles.css',
    BUNDLE_JSON=require('./bundle.json'),
    BUNDLE='./bundle';



gulp.task('default',function(){
    console.log(REPO_NAME + ' ..."tasks: gulp build|minify"');
});

gulp.task('build',function(){
    fileStream(DUST,DIST);
    concatFileStream(DUSTH,DIST,'dust.helpers.js');
    fileStream(UTILS,DIST);
    fileStream(MOMENT,DIST);
    fileStream(JQ,DIST);
    fileStream(JQEXT,DIST);
    fileStream(MS,DIST);
    fileStream(CSS,DIST);
    concatStream(BUILD_NAME)
        .pipe(gulp.dest(DIST));
});

gulp.task('minify',function(){
    minFileStream(DUST,DIST,'dust.min.js');
    minFileStream(DUSTH,DIST,'dust.helpers.min.js');
    minFileStream(JQ,DIST,'jquery.min.js');
    minFileStream(JQEXT,DIST,'jquery.extensions.min.js');
    minFileStream(MS,DIST,'mutation.summary.min.js');
    minFileStream(UTILS,DIST,'elliptical.utils.min.js');
    minFileStream(MOMENT,DIST,'moment.min.js');
    concatStream(MIN_NAME)
        .pipe(uglify())
        .pipe(gulp.dest(DIST));
});




function srcStream(){
    return gulp.src(BUILD_JSON);
}

function concatStream(name){
    return srcStream()
        .pipe(concat(name))
}

function fileStream(src,dest){
    gulp.src(src)
        .pipe(gulp.dest(dest));
}

function concatFileStream(src,dest,name){
    gulp.src(src)
        .pipe(concat(name))
        .pipe(gulp.dest(dest));
}

function minFileStream(src,dest,name){
    gulp.src(src)
        .pipe(concat(name))
        .pipe(uglify())
        .pipe(gulp.dest(dest));
}
