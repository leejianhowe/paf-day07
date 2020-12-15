const express = require('express')
const morgan = require('morgan')
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

const app = express()

app.use(morgan('combined'))

app.engine('hbs',hbs({defaultLayout:'main.hbs'}))
app.set('view engine','hbs')

// upload image
app.post('/upload', upload.single('image'), (req, res) => {
    // to listen on the 'finish' event we can call delete function
    // CLEAN UP TECHNIQUE
    // console.log('body',req.body)
    // console.log('file',req.file)
    res.on('finish', () => {
        fs.unlink(req.file.path, () => {
            console.log('deleted', req.file.filename)
        })
    })
    // to do convert to promise instead of call back functions
    fs.readFile(req.file.path, (err, data) => {
        if (err) throw err
        const params = {
            Bucket: 'storagedb',
            Key: req.file.filename,
            Body: data,
            ACL: 'public-read',
            ContentType: req.file.mimetype,
            ContentLength: req.file.size,
            Metadata: {
                originalName: req.file.originalname,
                update: '' + new Date(),
            },
        }
        s3.putObject(params, (err, results) => {
            if (err) {
                console.log(err)
                res.status(500).send({ error: err.message })
            }
            console.log('success upload', results)
            const docu = makeTemperature(req.body, req.file.filename)
            mongoClient
                .db(MONGO_DB)
                .collection(MONGO_COLLECTION)
                .insertOne(docu)
                .then(() => {
                    res.status(200)
                        .type('application/json')
                        .send({ message: 'ok' })
                })
                .catch((err) => {
                    console.log(err)
                    res.status(500)
                        .type('application/json')
                        .json({ error: err.message })
                })
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
        app.listen(PORT, () => {
            console.log(`APP started on ${PORT} on ${new Date()}`)
        })
    })
    .catch((err) => {
        console.log(err)
    })
