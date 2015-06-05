/**
 * Command line youtube browser. Searches youtube
 * for query passed and retrieves url of best search
 * result to play in vlc.
 */

var http 	= require('http');
var https 	= require('https');
var fs 		= require('fs');
var spawn 	= require('child_process').exec;
var io 		= require('socket.io');

var vlcProcess 	= null;
var processData = null; // nowplaying
var playing 	= false;

var clients 	= { length: 0 };


var mimes 	= {

	'css' 	: 'text/css' 				,
	'html' 	: 'text/html' 				,
	'ico' 	: 'image/x-icon'			,
	'jpg' 	: 'image/jpeg'				,
	'jpeg' 	: 'image/jpeg' 				,
	'js' 	: 'application/javascript' 	,
	'map' 	: 'application/x-navimap'	,
	'pdf' 	: 'application/pdf' 		,
	'png' 	: 'image/png'				,
	'ttf'	: 'application/octet-stream',
	'txt' 	: 'text/plain'				,
	'woff'	: 'application/x-font-woff'

};

var router	= {
	'/' : '/index.html'
};

var app = http.createServer(function(request, response) {

	var url = request.url;

	// determine if api request
	if(url.match(/\/api\//gi)) {

		if(!url.match(/(\/(search|action|song)\/)(.*)/gi)) {

			response.writeHead(200);
			return response.end(JSON.stringify({ success: false, message: 'Invalid request.' }));

		}

		var param = url.split('/api/')[1].split('/');

		if(param[0] == 'search') {

			var query = url.split('/search/')[1];

			playVideoUri(query, function(data) {
				console.log('request completed');
				response.writeHead(200);
				response.end(data);
			});

		} else if(param[0] == 'action' && param[1] == 'pause') {

			if(!vlcProcess) {
				return response.end('no_stream_loaded');
			}

			vlcProcess.stdin.write('pause\n');

			if(playing) {
				playing = false;
			} else {
				playing = true;
			}

			response.end('success');

		} else if(param[0] == 'action' && param[1] == 'songdata') {

			if(processData && vlcProcess) {

				if(playing) {
					processData.playing = true;
				} else {
					processData.playing = false;
				}

				return response.end(JSON.stringify(processData));
			}

			response.end('NO_DATA');

		}

	} else {

		var filepath = router[url] || url;

		// detect queries in url
		if(filepath.match(/\?/gi)) {
			filepath = filepath.split('?')[0];
		}

		fs.readFile(__dirname + filepath, function(err, data) {

			if(err) {
				response.writeHead(404);
				return response.end('ERR: File ' + filepath + ' could not be found');
			}

			var filepart = filepath.split('.');
			var filetype = filepart[filepart.length - 1];

			response.writeHead(200, { 'Content-Type': mimes[filetype] });
			response.end(data);

		});

	}

});

/**
 * Calls function scrapeUri, finds best youtube match from
 * scraped content and spawns a child process with command-line
 * vlc to play the video
 *
 */
function playVideoUri(query, callback) {
	scrapeUri(query, callback);
}

function scrapeUri(query, callback) {

	var protocol 	= https;

	var options = {

		hostname 	: 'www.googleapis.com',
		path		: '/youtube/v3/search?part=snippet&q=' + query + '&maxResults=1&order=relevance&type=video&key=AIzaSyClMhYOSK5GwHoXL7f66Siw4y36BIGwGDM',

	}

	protocol.get(options, function(response) {

		var data = '';

		response.on('data', function(chunk) {
			data += chunk;
		});

		response.on('end', function() {

			var videoData 	= JSON.parse(data);
			var videoUri 	= 'https://www.youtube.com/watch?v=' + videoData.items[0].id.videoId;

			processData 	= videoData;
			playing 		= true;

			// determine if vlc child process exists
			if(vlcProcess) {
			
				// stop current song and clear playlist
				vlcProcess.stdin.write('stop\n');
				vlcProcess.stdin.write('clear\n');

				// add and play new song
				vlcProcess.stdin.write('add ' + videoUri + '\n');

				console.log('Now playing \'' + videoData.items[0].snippet.title + '\'...');

				// return response to client
				callback.call(this, JSON.stringify({ success: true, message: 'success', data: videoData.items }));

				return;
			}

			console.log('> Now playing \'' + videoData.items[0].snippet.title + '\'...');

			// return response to client
			callback.call(this, JSON.stringify({ success: true, message: 'success', data: videoData.items }));

			vlcProcess = spawn('/Applications/VLC.app/Contents/MacOS/VLC --play-and-exit --intf=rc "' + videoUri + '"', function(err, stdout, stderr) {

				if(err) {
					return console.log('Child Process Error -> ' + err);
				}

				playing = true;
				console.log('> Now playing \'' + query + '\'...');

			});

			/**
			 * Called when a song is switched
			 */
			vlcProcess.on('exit', function() {

				console.log('process ended');
				playing = false;
				processExited = true;

			});

			/**
			 * Called when a song is interrupted or ends
			 */
			vlcProcess.on('close', function() {
				
				if(processExited) {

					console.log('process exited and closed');
					processExited = false;

				} else {
					console.log('process closed without exiting');
				}

				// garbage collect process
				vlcProcess = null;

				if(clients) {
					
					// tell each client that the song ended
					for(var i in clients) {

						if(clients[i] && clients[i].emit) {
							clients[i].emit('songended', { playing: false });
						}

					}

				}

			});

			vlcProcess.on('message', function(messsage) {
				console.log('process message -> ' + message);
			});

		});

	});

}

app.listen(8000, '0.0.0.0');

io.listen(app).on('connection', function(client) {

	console.log('client connected');

	clients[client.id] = client;
	clients.length++;

	console.log(clients.length);

	client.on('songdata', function(data) {
		console.log('client sent data');
		client.broadcast.emit('songdata', data);
	});

	client.on('songpause', function() {
		client.broadcast.emit('songpause');
	});

	client.on('songplay', function() {
		client.broadcast.emit('songplay');
	});

	client.on('disconnect', function() {
		delete clients[client.id];
		clients.length--;
	});

});