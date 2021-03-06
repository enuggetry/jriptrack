//
const fs = require("fs-extra");
const request = require("request");
const async = require("async");
const _ = require('lodash');

//let baseurl = "https://urgi.versailles.inra.fr/jbrowseiwgsc/gmod_jbrowse/";
let baseurl = "https://wheat.pw.usda.gov/GGbrowse/";
let trackname = "hiconf-1.1";
let targetdir = "data/";


let getopt = require('node-getopt');
let opt = new getopt([
    ['u','url=ARG'          ,'base URL of the source JBrowse dataset'],
    ['n','name=ARG'         ,'track name'],
    ['d','dir=ARG'          ,'local target directory'],
    ['t','gettracklist'     ,'retrieve trackList.json for the given URL']
])
.setHelp(
    "Usage: node jriptrack.js [OPTION]\n" +
    "\n" +
    "[[OPTIONS]]\n" +
    "\n" +
    "node jriptrack.js -t -u https://wheat.pw.usda.gov/GGbrowse/genome/whe_Ta_ABD_IWGSC-WGA-v1.0_2017\n" +
    "node jriptrack.js -u https://wheat.pw.usda.gov/GGbrowse/genome/whe_Ta_ABD_IWGSC-WGA-v1.0_2017 -n hiconf-1.1 -d data\n" +
    "\n"
)
.bindHelp()
.parseSystem();

if (_.isEmpty(opt.options)) {
    opt.showHelp();
    process.exit(0);
}

//console.log(opt.options);

// download only trackList.json
if (opt.options.url && opt.options.gettracklist) {
    baseurl = opt.options.url;
    if (baseurl.slice(-1) !== '/') baseurl += '/';

    console.log('retrieve trackList.json');

    let tracklist = baseurl+'trackList.json';

    request(tracklist, function (err, response, body) {
        if (err) {
            console.log(err);
            return;
        }
        
        fs.writeFile('trackList.json',body);
    });
}

// download entire track data
else if (opt.options.url && opt.options.name && opt.options.dir) {
    baseurl = opt.options.url;
    trackname = opt.options.name;
    targetdir = opt.options.dir;

    //console.log(typeof targetdir);
    // ensure trailing /
    if (baseurl.slice(-1) !== '/') baseurl += '/';
    if (targetdir.slice(-1) !== '/') targetdir += '/';

    processDownload();
}
// exit if we didn't get the parameters we need
else {
    console.log('missing parameters');
}

let reqarray = {
    count:0,
    list:[ ],
    sendToQueue (item) {
        if (fs.existsSync(item.path+item.file)) return; // skip if file already exists
        this.list.push(item);
        this.count++;
    }
};
// main processing - download all files
function processDownload() {
    getRefSeqs(function(chrlist,err) {
        if (err) {
            console.log(err);
            return;
        }
        let reqtrackcount = 0;
        // chrlist is content of seq/refSeqs.json

        // queue up trackList.json
        // let names = {
        //     url: baseurl,
        //     path: targetdir,
        //     file: "trackList.json"
        // }
        // reqarray.sendToQueue(names);


        // look for trackData.json in each sequence (ie. chr1, chr2, etc.)
        for (i in chrlist) {
            let fi = baseurl+"tracks/"+trackname+"/"+chrlist[i].name+"/trackData.json";
            console.log("chr",chrlist[i].name);

            reqtrackcount++;
            
            getTrackData(fi,chrlist[i].name,function(trackData,chrname,err){
                if (err) {
                    console.log('error reading trackData.json for',chrname);
                    reqtrackcount--;
                    return;
                }
                //got trackData.json

                let dir = targetdir+'tracks/'+trackname+'/'+chrname+'/';
                fs.ensureDirSync(dir);

                // write trackData.json
                fs.writeFileSync(dir+"trackData.json",JSON.stringify(trackData));

                // queue up names.txt
                let names = {
                    url: baseurl+"tracks/"+trackname+"/"+chrname+'/',
                    path: dir,
                    file: "names.txt"
                }
                reqarray.sendToQueue(names);

                let histograms = trackData.histograms.stats;
                for(j in histograms) {
                    let item = {
                        url:baseurl+"tracks/"+trackname+"/"+chrname+"/",
                        path:dir,
                        file:"hist-"+histograms[j].basesPerBin+"-0.json"
                    };
                    reqarray.sendToQueue(item);
                }

                let nclist = trackData.intervals.nclist;
                for(j in nclist) {
                    let item = {
                        url:baseurl+"tracks/"+trackname+"/"+chrname+"/",
                        path:dir,
                        file:"lf-"+nclist[j][3]+".json"
                    };
                    reqarray.sendToQueue(item);
                }
                reqtrackcount--;
            });

        }
        // detect when all trackData.json requests are completed
        let t = setInterval(function(){
            if (reqtrackcount==0) {
                clearInterval(t);
            
                console.log("Starting requests "+reqarray.count);

                // submit all requests in queue
                async.eachLimit(reqarray.list,100, function(item, cb) {
                    copyFile(item,function(item,err){
                        reqarray.count--;
                        if (err) {
                            console.log("request failed",item.url,err);
                            return cb(err);
                        }
                        item.complete = true;
                        process.stdout.write("requests remaining "+reqarray.count+" - "+item.path+item.file+"         \r");
                        cb();
                    });
                }, function(err) {
                    // if any of the file processing produced an error, err would equal that error
                    if( err ) {
                    // One of the iterations produced an error.
                    // All processing will now stop.
                    console.log('A file failed to process');
                    } else {
                    console.log('All files have been processed successfully');
                    }
                });                

                // wait for all requests to complete
                let lastcount = 0
                let t2 = setInterval(function() {
                    if (reqarray.count === lastcount) {
                        clearInterval(t2);
                        console.log("remaining requests ",reqarray.count);

                        // show remaining requests
                        for(k in reqarray.list) {
                            if (typeof reqarray.list[k].complete === 'undefined') {
                                console.log(k,reqarray.list[k].path+" "+reqarray.list[k].file);
                            }
                        }
                    }
                    lastcount = reqarray.count;
                },2000);
                

            }
        },500);
        //console.log(json);
    });
}
/*
    get refSeqs.json file 
*/
function getRefSeqs(cb) {
    let seqdatafile = baseurl+"seq/refSeqs.json";

    request(seqdatafile, function (err, response, body) {
        if (err) return cb(null,err);
        return cb(JSON.parse(body),null);
      });
}
/*
    get trackData.json
    fi - filename
    chrname chromosome
    cb callback
*/
function getTrackData(fi,chrname,cb) {
    request(fi, function (err, response, body) {
        if (err) return cb(null,null,err);
        return cb(JSON.parse(body),chrname,null);
      });
}
/*
    copies a file (fi) from fileurl to filedir
*/
function copyFile(item,cb) {
    request(item.url+item.file, function (err, response, body) {
        if (err) return cb(item,err);

        fs.ensureDirSync(item.path);
        fs.writeFile(item.path+item.file,body);
        return cb(item);
    });
}
