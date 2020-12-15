const express = require('express')
const morgan = require('morgan')
// nodejs
const EventEmitter = require('events')
const myEmitter = new EventEmitter()
const path = require('path');

// const MongoClient = require('mongodb').MongoClient
// const ObjectId = require('mongodb').ObjectId
// Timestamp is a module of mongodb unique to mongodb
// depending on type of module exported by packages we can import it in this fashion
const { MongoClient, ObjectId } = require('mongodb')
const multer = require('multer')
const multerS3 = require('multer-s3')
const AWS = require('aws-sdk')

const hbs = require('express-handlebars')

const fs = require('fs')

const PORT = parseInt(process.argv[2]) || parseInt(process.env.PORT) || 3000

const MONGO_URL = 'mongodb://localhost:27017'
const MONGO_DB = 'temperature'
const MONGO_COLLECTION = 'dailytemp'

// multer
const DEST = 'uploads'

const mongoClient = new MongoClient(MONGO_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})

const endpoint = new AWS.Endpoint('sfo2.digitaloceanspaces.com')
const s3 = new AWS.S3({
    endpoint: endpoint,
})

const makeTemperature = (params, filename) => {
    return {
        ts: new Date(),
        user: params.user,
        q1: JSON.parse(params.q1),
        q2: JSON.parse(params.q2),
        temperature: parseFloat(params.temperature),
        image: filename,
    }
}
// multer using local storage

const upload = multer({ dest: DEST })

// // multer using multerS3
// const upload = multer({
//     storage:multerS3({
//         s3:s3,
//         bucket:'storagedb',
//         acl:'public-read',
//         metadata:function(req,file,cb){
//             cb(null,Object.assign({},req.body))
//         },
//         key:function(req,file,cb){
//             cb(null,Date.now().toString())
//         }

//     })
// })

// listener function
myEmitter.on('end',()=>{

    // deletes files in uploads on start of server
    fs.readdir(path.join(__dirname, 'uploads'),(err,files)=>{
        if(err)
            throw err
        if(files.length){
            console.log(files)
            files.forEach((ele)=>{
                fs.unlink(path.join(__dirname,'uploads',ele),()=>{
                    console.log('emptied files in uploads')
                })
            })
            console.log('emptied files in uploads') 
        }
    })
})

const app = express()

app.use(morgan('combined'))

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
    readFile(req.file.path)
        .then(data =>
            putObject(req.file, data))
        .then(results => {
            console.log(results)
            return mongoClient
                .db(MONGO_DB)
                .collection(MONGO_COLLECTION)
                .insertOne(docu)
        })
        .then(results => {
            console.log(results)
            res.status(200)
                .type('application/json')
                .send({
                    message: 'ok',
                    id:results.ops[0]._id
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

// // post temperature only for json data no file
// app.post('/temperature', express.json(), (req, res) => {
//     // req.body.user, req.body.q1 ,req.body.q2 req.body.temperature
//     const docu = makeTemperature(req.body)
//     // insert doc into mongodb
//     mongoClient
//         .db(MONGO_DB)
//         .collection(MONGO_COLLECTION)
//         .insertOne(docu)
//         .then(() => {
//             res.status(200).type('application/json').send({ message: 'ok' })
//         })
//         .catch((err) => {
//             console.log(err)
//             res.status(500)
//                 .type('application/json')
//                 .json({ error: err.message })
//         })
// })

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
// todo

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
        myEmitter.emit('end')
    }).then(()=>{
        app.listen(PORT, () => {
            console.log(`APP started on ${PORT} on ${new Date()}`)
        })
    })
    .catch((err) => {
        console.log(err)
    })
