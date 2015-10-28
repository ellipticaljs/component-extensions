
var gulp=require('gulp'),
    fs = require('fs-extra'),
    concat=require('gulp-concat'),
    uglify = require('gulp-uglify'),
    BUILD_JSON=require('./build.json'),
    BUILD_NAME='component.extensions.js',
    MIN_NAME='component.extensions.min.js',
    REPO_NAME='component extensions',
    DIST='./dist',
    DUST=['./node_modules/dustjs/dist/dust.js','./node_modules/dustjs-helpers/dist/dust-helpers.js','./lib/dust-helpers'],
    JQEXT='./node_modules/jquery-extensions/dist/jquery.extensions.js',
    JQ='./node_modules/jquery-extensions/dist/jquery.js',
    MS='./node_modules/jquery-extensions/dist/mutation-summary.js',
    UTILS='./node_modules/elliptical-utils/dist/elliptical.utils.js',
    MOMENT='./node_modules/moment/moment.js',
    CSS='./css/styles.css';




gulp.task('default',function(){
    console.log(REPO_NAME + ' ..."tasks: gulp build|gulp minify"');
});

gulp.task('build',function(){
    concatFileStream(DUST,'dust.js');
    fileStream(MS);
    fileStream(JQ);
    fileStream(JQEXT);
    fileStream(UTILS);
    fileStream(MOMENT);
    fileStream(CSS);
    concatStream(BUILD_NAME)
        .pipe(gulp.dest(DIST));
});

gulp.task('minify',function(){
    minFileStream(DUST,'dust.min.js');
    minFileStream(MS,'mutation-summary.min.js');
    minFileStream(JQ,'jquery.min.js');
    minFileStream(JQEXT,'jquery.extensions.min.js');
    minFileStream(UTILS,'elliptical.utils.min.js');
    minFileStream(MOMENT,'moment.min.js');
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

function fileStream(src){
    gulp.src(src)
        .pipe(gulp.dest(DIST));
}

function concatFileStream(src,name){
    gulp.src(src)
        .pipe(concat(name))
        .pipe(gulp.dest(DIST));
}

function minFileStream(src,name){
    gulp.src(src)
        .pipe(concat(name))
        .pipe(uglify())
        .pipe(gulp.dest(DIST));
}
