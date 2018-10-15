require('dotenv').config();
const argv = require('yargs').argv;
const request = require('superagent');
const cheerio = require('cheerio');
const querystring = require('querystring');


const baseUrl = 'https://panda.uni-paderborn.de';

const urls = {
    getSessionKeepalive: () => baseUrl + '/my/',
    getIndex: () => baseUrl + '/my/?myoverviewtab=courses',
    getCourseIndex: (courseId) => baseUrl + '/course/view.php?id=' + courseId,
    getFolderIndex: (folderId) => baseUrl + '/mod/folder/view.php?id=' + folderId
};

const getSessionCookie = () => 'MoodleSessionupblms=' + process.env.SESSION_COOKIE;

const syncDirectory = process.env.SYNC_DIRECTORY || './sync';

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
                    files.forEach(file => {
                        //console.log('DOWNLOAD: course ' + course + ' / folder ' + folder + ' / file ' + file.file);
                        console.log('DOWNLOAD: ' + file.course + ' / ' + file.folder + ' / ' + file.file);
                    });
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
        //.map(url => querystring.parse(url.split('?')[1])['id']);
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
        //.map(url => querystring.parse(url.split('?')[1])['id']);
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

    let   course = $('#page-header .page-header-headings').text();
    const folder = $('#page-header .breadcrumb-item').last().text(); // not sure if working in all situations (robustness)

    if( !course ) {
        console.log("WARNING - course name is empty (tried selector $('#page-header .page-header-headings') on folder page)");
    }
    else {
        if( purifyCourseNamesFlag ) {
            course = purifyCourseNameRegex.exec(course)[1];
        }
    }
    if( !folder ) {
        console.log("WARNING - folder name is empty (tried selector $('#page-header .breadcrumb-item').last() on folder page)");
    }

    let folderIds = $('#region-main .foldertree a')
        .map((i, elem) => $(elem).attr('href')) // cheerio/jQuery map function!
        .toArray()
        //.map(elem => {console.log('MATCH ' + elem); return elem})
        .map(elem => elem.split('?', 2)[0])
        .filter(url => urlTestRegex.test(url))
        //.map(url => parseInt(urlTestRegex.exec(url)[1]));

    // filter out possible duplicates
    folderIds = folderIds.filter((elem, pos) => folderIds.indexOf(elem) == pos);

    folderIds = folderIds.map(url => {
        return {
            'file': urlTestRegex.exec(url)[1],
            url,
            folder,
            course
        }
    });

    return folderIds;
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