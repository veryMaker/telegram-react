class VideoConverter {
    static convert(videoBlob, callback) {
        var workerPath = window.location.href + '/ffmpeg-all-codecs.js';

        function log(message) {
            console.log('VVV', message);
        }

        function processInWebWorker() {
            var blob = URL.createObjectURL(
                new Blob(
                    [
                        'importScripts("' +
                            workerPath +
                            '");var now = Date.now;function print(text) {postMessage({"type" : "stdout","data" : text});};onmessage = function(event) {var message = event.data;if (message.type === "command") {var Module = {print: print,printErr: print,files: message.files || [],arguments: message.arguments || [],TOTAL_MEMORY: message.TOTAL_MEMORY || false};postMessage({"type" : "start","data" : Module.arguments.join(" ")});postMessage({"type" : "stdout","data" : "Received command: " +Module.arguments.join(" ") +((Module.TOTAL_MEMORY) ? ".  Processing with " + Module.TOTAL_MEMORY + " bits." : "")});var time = now();var result = ffmpeg_run(Module);var totalTime = now() - time;postMessage({"type" : "stdout","data" : "Finished processing (took " + totalTime + "ms)"});postMessage({"type" : "done","data" : result,"time" : totalTime});}};postMessage({"type" : "ready"});'
                    ],
                    {
                        type: 'application/javascript'
                    }
                )
            );
            var worker = new Worker(blob);
            URL.revokeObjectURL(blob);
            return worker;
        }

        var worker;

        function convertStreams(videoBlob) {
            var aab;
            var buffersReady;
            var workerReady;
            var posted;
            var fileReader = new FileReader();
            fileReader.onload = function() {
                aab = this.result;
                postMessage();
            };
            fileReader.readAsArrayBuffer(videoBlob);
            if (!worker) {
                worker = processInWebWorker();
            }
            worker.onmessage = function(event) {
                var message = event.data;
                if (message.type == 'ready') {
                    log(
                        '<a href="' + workerPath + '" download="ffmpeg-asm.js">ffmpeg-asm.js</a> file has been loaded.'
                    );
                    workerReady = true;
                    if (buffersReady) postMessage();
                } else if (message.type == 'stdout') {
                    log(message.data);
                } else if (message.type == 'start') {
                    log(
                        '<a href="' +
                            workerPath +
                            '" download="ffmpeg-asm.js">ffmpeg-asm.js</a> file received ffmpeg command.'
                    );
                } else if (message.type == 'done') {
                    log(JSON.stringify(message));
                    var result = message.data[0];
                    log(JSON.stringify(result));
                    var blob = new File([result.data], 'test.mp4', {
                        type: 'video/mp4'
                    });
                    log(JSON.stringify(blob));
                    callback(blob);
                }
            };
            var postMessage = function() {
                posted = true;
                worker.postMessage({
                    type: 'command',
                    arguments: '-i video.webm -c:v libx264 -b:v 6400k -strict experimental output.mp4'.split(' '),
                    files: [
                        {
                            data: new Uint8Array(aab),
                            name: 'video.webm'
                        }
                    ],
                    TOTAL_MEMORY: 268435456
                });
            };
        }

        convertStreams(videoBlob);
    }
}

export default VideoConverter;
