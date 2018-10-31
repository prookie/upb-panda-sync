const fs = require('fs');
const path = require('path');
require('dotenv').config({path: path.resolve(__dirname, '.env')})
const argv = require('yargs').argv;
const request = require('superagent');
const cheerio = require('cheerio');
const sanitize = require('sanitize-filename');
const moment = require('moment');


const baseUrl = 'https://panda.uni-paderborn.de';

const urls = {
    getSessionKeepalive: () => baseUrl + '/my/',
    getIndex: () => baseUrl + '/my/?myoverviewtab=courses',
    getCourseIndex: courseId => baseUrl + '/course/view.php?id=' + courseId,
    getFolderIndex: folderId => baseUrl + '/mod/folder/view.php?id=' + folderId
};

const getSessionCookie = () => 'MoodleSessionupblms=' + process.env.SESSION_COOKIE;

const syncDirectory = process.env.SYNC_DIRECTORY || path.resolve(__dirname, 'sync');

const purifyCourseNameRegex = /^\w?(?:\.\w+)*[\t ](.+)$/i;
const purifyCourseNamesFlag = !!process.env.PURIFY_COURSE_NAMES;


if( argv.sessionKeepalive ) {
    performSessionKeepalive();
    return;
}



getCourses().then(courses => {
    courses.forEach(course => {
        console.log('CRAWL: course ' + course);
        getFolders(course).then(folders => {
            folders.forEach(folder => {
                console.log('CRAWL: course ' + course + ' / folder ' + folder);
                getFiles(folder).then(files => {
                    const downloadFileSequentially = (files, index) => {
                        if( index >= files.length ) return;

                        const file = files[index];
                        const destination = path.resolve(syncDirectory, file.course, file.folder, file.file);

                        downloadChangedFile(file.url, destination).then(
                            () => downloadFileSequentially(files, index + 1),
                            () => downloadFileSequentially(files, index + 1)
                        );
                    };

                    downloadFileSequentially(files, 0);
                });
            });
        });
    });
}).catch((err) => {
    console.log('catched getCourses()');
});




function getCourses() {
    return new Promise((resolve, reject) => {
        request.get(urls.getIndex())
            .set('Cookie', getSessionCookie())
            .redirects(0)
            .timeout(30 * 1000)
            .retry(3)
            .then(res => {
                if( res.statusType == 2 ) {
                    //console.log('getCourses response: ' + res.request.url);

                    let courses = null;
                    try {
                        courses = extractCoursesFromResponse(res.text);

                        // TODO: implement whitelisting/blacklisting here
                    }
                    catch( e ) {
                        console.log(e);
                        reject();
                        return;
                    }

                    resolve(courses);
                }
                else {
                    // wtf?
                    // TODO: handle session expiration, maybe log / send mail?
                    console.log(res.request.url);
                    console.log('request OK, but status = ' + res.status);
                    reject();
                }
            })
            .catch(err => {
                handleResponseCatch(err);
                reject();
            });
    });
}
function extractCoursesFromResponse(responseBody) {
    const urlTestRegex = /\/course\/view\.php(?:\?.*&|\?)id=(\d+)/i;
    const $ = cheerio.load(responseBody);

    let courseIds = $('#myoverview_courses_view_in_progress .courses-view-course-item > a')
        .map((i, elem) => $(elem).attr('href')) // cheerio/jQuery map function!
        .toArray()
        .filter(url => urlTestRegex.test(url))
        .map(url => parseInt(urlTestRegex.exec(url)[1]));

    // filter out possible duplicates
    courseIds = courseIds.filter((elem, pos) => courseIds.indexOf(elem) == pos);

    return courseIds;
}

function getFolders(courseId) {
    return new Promise((resolve, reject) => {
        request.get(urls.getCourseIndex(courseId))
            .set('Cookie', getSessionCookie())
            .redirects(0)
            .timeout(30 * 1000)
            .retry(3)
            .then(res => {
                if( res.statusType == 2 ) {
                    //console.log('getFolders response: ' + res.request.url);

                    let folders = null;
                    try {
                        folders = extractFoldersFromResponse(res.text);

                        // TODO: implement whitelisting/blacklisting here
                    }
                    catch( e ) {
                        console.log(e);
                        reject();
                        return;
                    }

                    resolve(folders);
                }
                else {
                    // wtf?
                    // TODO: handle session expiration, maybe log / send mail?
                    console.log(res.request.url);
                    console.log('request OK, but status = ' + res.status);
                    reject();
                }
            })
            .catch(err => {
                handleResponseCatch(err);
                reject();
            });
    });
}
function extractFoldersFromResponse(responseBody) {
    const urlTestRegex = /\/mod\/folder\/view\.php(?:\?.*&|\?)id=(\d+)/i;
    const $ = cheerio.load(responseBody);

    let folderIds = $('#region-main .course-content .activity.folder a')
        .map((i, elem) => $(elem).attr('href')) // cheerio/jQuery map function!
        .toArray()
        .filter(url => urlTestRegex.test(url))
        .map(url => parseInt(urlTestRegex.exec(url)[1]));

    // filter out possible duplicates
    folderIds = folderIds.filter((elem, pos) => folderIds.indexOf(elem) == pos);

    return folderIds;
}

function getFiles(folderId) {
    return new Promise((resolve, reject) => {
        request.get(urls.getFolderIndex(folderId))
            .set('Cookie', getSessionCookie())
            .redirects(0)
            .timeout(30 * 1000)
            .retry(3)
            .then(res => {
                if( res.statusType == 2 ) {
                    //console.log('getFiles response: ' + res.request.url);

                    let files = null;
                    try {
                        files = extractFilesFromResponse(res.text);
                    }
                    catch( e ) {
                        console.log(e);
                        reject();
                        return;
                    }

                    resolve(files);
                }
                else {
                    // wtf?
                    // TODO: handle session expiration, maybe log / send mail?
                    console.log(res.request.url);
                    console.log('request OK, but status = ' + res.status);
                    reject();
                }
            })
            .catch(err => {
                handleResponseCatch(err);
                reject();
            });
    });
}
function extractFilesFromResponse(responseBody) {
    const urlTestRegex = /\/pluginfile\.php\/(?:[^/]+)\/mod_folder\/content(?:.*)\/([^/?]+)(?:\?.*)?$/i;
    const $ = cheerio.load(responseBody);

    let course = $('#page-header .page-header-headings').text();
    let folder = $('#page-header .breadcrumb-item').last().text(); // not sure if working in all situations (robustness)

    if( !course ) {
        console.log("WARNING - course name is empty (tried selector $('#page-header .page-header-headings') on folder page)");
    }
    else {
        if( purifyCourseNamesFlag ) {
            course = purifyCourseNameRegex.exec(course)[1];
        }

        course = sanitize(course);
    }
    if( !folder ) {
        console.log("WARNING - folder name is empty (tried selector $('#page-header .breadcrumb-item').last() on folder page)");
    }
    else {
        folder = sanitize(folder);
    }

    let folderUrls = $('#region-main .foldertree a')
        .map((i, elem) => $(elem).attr('href')) // cheerio/jQuery map function!
        .toArray()
        .map(elem => elem.split('?', 2)[0])
        .filter(url => urlTestRegex.test(url));

    // filter out possible duplicates
    folderUrls = folderUrls.filter((elem, pos) => folderUrls.indexOf(elem) == pos);

    const folders = folderUrls.map(url => {
        return {
            'file': sanitize(urlTestRegex.exec(url)[1]),
            url,
            folder,
            course
        };
    });

    return folders;
}

function performSessionKeepalive() {
    request.get(urls.getSessionKeepalive())
        .set('Cookie', getSessionCookie())
        .redirects(0)
        .timeout(30 * 1000)
        .retry(3)
        .then(res => {
            if( res.statusType == 2 ) {

            }
            else {
                // wtf?
                // TODO: handle session expiration, maybe log / send mail?
                console.log(res.req.path);
                console.log('request OK, but status = ' + res.status);
            }
        })
        .catch(err => {
            handleResponseCatch(err);
        });
}


function downloadFile(url, destination) {
    //console.log('DOWNLOAD: ' + url + ' INTO ' + destination);

    ensureDirectoryExistence(destination);

    return new Promise((resolve, reject) => {
        const fileStream = fs.createWriteStream(destination);

        request.get(url)
            .set('Cookie', getSessionCookie())
            .timeout({
                response: 30 * 1000,
                deadline: 60 * 1000
            })
            .pipe(fileStream)
            .on('finish', resolve)
            .on('error', reject);
    });
}

function downloadChangedFile(url, destination) {
    ensureDirectoryExistence(destination);

    return new Promise((resolve, reject) => {
        fs.stat(destination, (err, stats) => {
            if( err ) {
                // file does not exist, just download
                downloadFile(url, destination).then(res => {
                    console.log('FILE WAS DOWNLOADED BECAUSE MISSING LOCALLY: ' + destination);
                    resolve(res);
                }, reject);
                return;
            }

            // file does exist, check if older than version on server
            request.head(url)
                .set('Cookie', getSessionCookie())
                .timeout(30 * 1000)
                .retry(3)
                .then(res => {
                    if( !res.header['last-modified'] ) {
                        // TODO: log / send mail? no Last-Modified header gets sent, this is problematic
                        console.log('WARNING: no Last-Modified header was sent by ' + url);
                        reject();
                        return;
                    }

                    if( moment(stats.mtime).isAfter(res.header['last-modified']) ) {
                        // local file is newer than server version, skip
                        resolve();
                        return;
                    }

                    // local file is older than server version, download
                    downloadFile(url, destination).then(res => {
                        console.log('FILE WAS DOWNLOADED AGAIN BECAUSE THERE IS A NEWER VERSION ON PANDA: ' + destination);
                        resolve(res);
                    }, reject);

                })
                .catch(reject);


        });
    });
}

/**
 * Shamelessly copied from https://stackoverflow.com/a/34509653
 */
function ensureDirectoryExistence(filePath) {
    const dirname = path.dirname(filePath);
    if( fs.existsSync(dirname) ) {
        return true;
    }
    ensureDirectoryExistence(dirname);
    fs.mkdirSync(dirname);
}

function handleResponseCatch(err) {
    console.log(err.response.request.url);
    console.log('request catched');
    console.log(err.status);
    if( err.status >= 300 && err.status < 500 ) {
        // session expired
        // TODO: handle session expiration, maybe log / send mail?
    }
    else {
        // other unknown error
        // TODO: handle session expiration, maybe log / send mail?
    }
}
