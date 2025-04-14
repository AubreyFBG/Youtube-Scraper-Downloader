//Express Dependencies
const fs = require("fs")
const ejs = require("ejs");
const express = require("express")
const zip = require('express-zip');
const app = express()
const bodyParser = require('body-parser');
//Youtube Dependencies
const ytdl = require('@distube/ytdl-core');
const ytpl = require('ytpl');
//Audio Video Encode
const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);

app.engine("ejs", ejs.renderFile);
app.set("view engine", "ejs");
app.use("/images", express.static("./images"))
app.use("/css", express.static("./css"))
app.use(bodyParser.urlencoded({ extended: true }));

app.get("/", (req, res)=>{
    res.render("index.ejs")
})

app.get("/download/playlist", (req, res)=>{
    res.render("playlist.ejs", {
        playlist: undefined,
        searchStatus: null,
        searchVideos: null
    })
})
app.post("/download/playlist", (req, res)=>{
    const { playlist: playlistUrl, submitButton } = req.body

    if(submitButton == "search"){
        renderPlaylistURL(playlistUrl, res)
    }
    if(submitButton.startsWith("quality")){
        renderQualityPlaylist(playlistUrl, submitButton, res)
    }
    if(submitButton.startsWith("playlistDownload")){
        downloadAllOfPlaylist(submitButton, res)
    }

    if(submitButton.startsWith("download")){
        const [option, url, quality] = submitButton.split("}")
        downloadVideo(url, quality, res)
    }
})

app.get("/download/video", (req, res)=>{
    res.render("video.ejs",{
        video: undefined,
        searchStatus: null
    })
})

app.post("/download/video", (req, res)=>{
    const { video: videoURL, submitButton } = req.body
    if(submitButton == "search"){
        renderVideoURL(videoURL, res)
    }
    if(submitButton.startsWith("download")){
        const [down, url, quality] = submitButton.split("}")
        downloadVideo(url, quality, res)
    }

})

app.listen(3000,()=>{
    console.log("Projeto ligado na porta 3000")
})

async function downloadVideo(url, quality, res, downWait){
    const download = new Promise((resolve, reject)=>{
        ytdl.getInfo(url).then(video=>{
            const mp3Format = ytdl.chooseFormat(video.formats, { quality: "highestaudio", filter: 'audioonly' })
            mp3Format.qualityLabel = "mp3"
            video.formats.push(mp3Format)

            let format = video.formats.find(format => format.qualityLabel == quality)
            const title = video.videoDetails.title;
            const sanitizedTitle = title.replace(/[/\\?%*:|"<>]/g, ''); 
            const filename = `Downloads/${sanitizedTitle}.${quality == "mp3" ? "mp3" : "mp4"}`;

            if(quality == "Alta") format = video.formats.filter(quality=> quality.qualityLabel)[0]
            if(quality == "Baixa") format = video.formats.filter(quality=> quality.qualityLabel).reverse()[1]

            ytdl(url, { format })
            .pipe(fs.createWriteStream(filename))
            .on('finish', () => {
                if(quality == "mp3"){
                    resolve(filename)
                } else {
                    const filenameAudio = filename.replace("mp4", "mp3")
                    const outputFilename = `Downloads/${sanitizedTitle}${quality}.${quality == "mp3" ? "mp3" : "mp4"}`
                    ytdl(url, { format: mp3Format })
                    .pipe(fs.createWriteStream(filenameAudio))
                    .on('finish', () => {
                        ffmpeg()
                            .input(filename)
                            .input(filenameAudio)
                            .output(outputFilename)
                            .on('end', () => {
                            resolve(outputFilename)
                            })
                            .run();
                    })
                }
            })
            .on('error', (error) => {
                console.error(error)
                reject("Erro")
            });
        })
    })
    
    if(downWait) return await download

    download.then(async finish=>{
        res.download(__dirname + "/" + finish, ()=>{
            fs.unlink(finish, ()=>{})
        })
    }, err=>{
        console.error(err)
    })
}

function renderVideoURL(videoURL, res, addElements = {}){
    ytdl.getInfo(videoURL).then(video=>{
        video.formats.push({ qualityLabel: "mp3" })
        res.render("video.ejs", {
            video: videoURL,
            searchStatus: "sucess",
            iframe: video.videoDetails.embed.iframeUrl,
            name: video.videoDetails.title,
            duration: transformSeconds(video.videoDetails.lengthSeconds),
            formats: video.formats
            .filter((format) => format.qualityLabel)
            .map((format) => format.qualityLabel)
            .filter((format, i, arr)=> arr.indexOf(format) === i)
            .sort((a,b)=> parseInt(b) - parseInt(a)),
            ...addElements
        })
    }, err=>{
        res.render("video.ejs",{
            video: videoURL,
            searchStatus: "error"
        })
    })
}

function renderPlaylistURL(playlistUrl, res, addElements = { searchVideos: undefined }){
    ytpl(playlistUrl, { limit: Infinity })
    .then(async (playlist) => {
        res.render("playlist.ejs",{
            playlist: playlistUrl,
            searchStatus: "sucess",
            title: playlist.title,
            videoCounts: playlist.estimatedItemCount,
            thumb: playlist.bestThumbnail.url,
            totalMinutes: transformSeconds(playlist.items.map(a=> a.durationSec).reduce((a,b)=> a + b)),
            formats: ["Alta qualidade", "Baixa qualidade", "mp3"],
            ...addElements
        })
    }, err=>{
    res.render("playlist.ejs",{
        playlist: playlistUrl,
        searchStatus: "error",
        searchVideos: "error"
    })
  })
}

function renderQualityPlaylist(playlistUrl, submitButton, res){
    const [option, playlist, quality] = submitButton.split("}")
    ytpl(playlistUrl, { limit: Infinity })
    .then(async (playlist) => {
        renderPlaylistURL(playlistUrl, res, {
            quality,
            searchVideos: "sucess",
            videos: playlist.items.map(video=>{
                return {
                    name: video.title,
                    link: video.shortUrl,
                    thumb: video.bestThumbnail.url,
                    duration: video.duration
                }
            })
        })
}, err=>{
    res.render("playlist.ejs",{
        playlist: playlistUrl,
        searchStatus: "error"
    })
})
}

function downloadAllOfPlaylist(submitButton, res){
    const [option, url, quality] = submitButton.split("}")
        ytpl(url, { limit: Infinity })
        .then(async playlist=>{
            const downloads = playlist.items.map(async video=>{
                return await downloadVideo(video.shortUrl, quality, res, true)
            })
            const finishDownload = await Promise.all(downloads)
            res.zip(finishDownload.map(file=>{
                return { path: __dirname + "/" + file, name: file.split("/")[1] }
            }), playlist.title + ".zip", ()=>{
                finishDownload.forEach(path=>{      
                    fs.unlink(path, ()=>{})
                })
            })
            
        })
}

function transformSeconds(sec){
    const minutos = ~~(sec / 60)
    const horas = ~~(minutos / 60)
    const segundos = sec % 60
    return [`${horas% 60}h`,`${minutos% 60}m`, `${segundos}s`].filter(num => !num.startsWith("0")).map(num => num.padStart(3,0)).join(" ")
}
