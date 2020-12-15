const express = require('express')
const morgan = require('morgan')
// nodejs modules
const EventEmitter = require('events')
const myEmitter = new EventEmitter()
const path = require('path');
const process = require('process')

// const MongoClient = require('mongodb').MongoClient
// const ObjectId = require('mongodb').ObjectId
// Timestamp is a module of mongodb unique to mongodb
// depending on type of module exported by packages we can import it in this fashion
const { MongoClient, ObjectId } = require('mongodb')
const multer = require('multer')
const AWS = require('aws-sdk')

// load handlebars
const hbs = require('express-handlebars')

// use filesystem
const fs = require('fs')

// configure port
const PORT = parseInt(process.argv[2]) || parseInt(process.env.PORT) || 3000

// define mongo variables
const MONGO_URL = 'mongodb://localhost:27017'
const MONGO_DB = 'temperature'
const MONGO_COLLECTION = 'dailytemp'

const mongoClient = new MongoClient(MONGO_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})

// configure s3
const endpoint = new AWS.Endpoint('sfo2.digitaloceanspaces.com')
const s3 = new AWS.S3({
    endpoint: endpoint,
})

const makeTemperature = (params, filename) => {
    return {
        ts: new Date(),
        user: params.user,
        q1: 'true' === params.q1.toLowerCase(),
        q2: 'false'=== params.q2.toLowerCase(),
        temperature: parseFloat(params.temperature),
        image: filename,
    }
}
// multer
const DEST = 'uploads'
// multer using local storage
const upload = multer({ dest: DEST })


// listener function
myEmitter.on('end',()=>{
    // deletes files in uploads on start of server
    fs.readdir(path.join(__dirname, 'uploads'),(err,files)=>{
        if(err)
            throw err
        if(files.length){
            console.log(`No of files in upload: ${files.length}`)
            console.log(files)
            files.forEach((ele)=>{
                fs.unlink(path.join(__dirname,'uploads',ele),()=>{
                })
            })
            console.log(`deleted ${files.length} files in uploads`) 
        }
    })
})

// start app
const app = express()
// log incoming request
app.use(morgan('combined'))

// load view engine
app.engine('hbs',hbs({defaultLayout:'main.hbs'}))
app.set('view engine','hbs')

// convert fs.readFile call back function to Promise function
const readFile = (path) => {
    return new Promise((res, rej) => {
        fs.readFile(path, (err, data) => {
            if (err)
                rej(err)
            res(data)
        })
    })
}

// convert s3 object call back into function
const putObject = (file,data)=>{
    const params = {
        Bucket: 'storagedb',
        Key: file.filename,
        Body: data,
        ACL: 'public-read',
        ContentType: file.mimetype,
        ContentLength: file.size,
        Metadata: {
            originalName: file.originalname,
            update: '' + new Date(),
        },
    }
    return new Promise((res,rej)=>{
        s3.putObject(params,(err,results)=>{
            if(err)
                rej(err)
            res(results)

        })
    })
} 

// upload image
app.post('/upload', upload.single('image'), (req, res) => {
    // console.log('body',req.body)
    // console.log('file',req.file)

    // to listen on the 'finish' event we can call delete function
    // CLEAN UP TECHNIQUE
    // res.on('finish', () => {
    //     fs.unlink(req.file.path, () => {
    //         console.log('deleted', req.file.filename)
    //     })
    // })

    const docu = makeTemperature(req.body, req.file.filename)
    // Promise functions

    const p0 = readFile(req.file.path)
        .then(data =>
            putObject(req.file, data))
    const p1 = mongoClient
                .db(MONGO_DB)
                .collection(MONGO_COLLECTION)
                .insertOne(docu)
    Promise.all([p0,p1])
        .then(result=>{
            console.log('successfully upload image',result[0])
            console.log('successfully insert docu',result[1])
            res.status(200)
                    .type('application/json')
                    .send({
                        message: 'ok',
                        id:result[1].insertedId
                    })
        })
        .catch((err) => {
            console.log(err)
            res.status(500)
                .type('application/json')
                .json({
                    error: err.message
                })
        })               
})

// get specific temperature record
app.get('/temperature/:user', (req, res) => {  
    const user = req.params.user
    mongoClient
        .db(MONGO_DB)
        .collection(MONGO_COLLECTION)
        .find({
            user: user,
        })
        .toArray()
        .then((result) => res.status(200).type('html').render('results',{result:result}))
})

// get all temperature record
app.get('/temperature', (req, res) => {
    mongoClient
        .db(MONGO_DB)
        .collection(MONGO_COLLECTION)
        .find({})
        .toArray()
        .then((result) => res.status(200).type('application/json').json(result))
})

// when express ends can use end function to clean up

const checkS3 = new Promise((res, rej) => {
    s3.config.getCredentials((err, cred) => {
        if (err) {
            rej(err)
        } else {
            res()
        }
    })
})


Promise.all([checkS3, mongoClient.connect()])
    .then(() => {
        // emits event to clear up uploads
        myEmitter.emit('end')
        
    }).then(()=>{
        // process.on('exit', function(code) {
        //     console.log(code)
        //     fs.readdir(path.join(__dirname, 'uploads'),(err,files)=>{
        //         if(err)
        //             throw err
        //         if(files.length){
        //             console.log(`No of files in upload: ${files.length}`)
        //             console.log(files)
        //             files.forEach((ele)=>{
        //                 fs.unlink(path.join(__dirname,'uploads',ele),()=>{
        //                 })
        //             })
        //             console.log(`deleted ${files.length} files in uploads`) 
        //         }
        //     })
        // });
        app.listen(PORT, () => {
            console.log(`APP started on ${PORT} on ${new Date()}`)
        })
    })
    .catch((err) => {
        console.log(err)
    })
