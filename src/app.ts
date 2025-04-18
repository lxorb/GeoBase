import { Coordinates, Storypoint, User, File } from "./types";

import express, { Express, Request, Response } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import cors from "cors";
import bcrypt from "bcrypt";
import config from "config";
import { MongoClient, ObjectId, GridFSBucket, PullOperator  } from 'mongodb';
import Fuse from 'fuse.js';
import multer from 'multer';
import sharp from 'sharp';
import fs from 'fs';
import archiver from 'archiver';

if (config.get('jwt_secret') === 'mysecret') {
  console.warn('Warning: JWT secret is default and should be changed in production');
}

const app: Express = express()
const emailRegex = /^(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9]))\.){3}(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9])|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])$/i;
const passwordRegex = /^(.{0,7}|[^0-9]*|[^A-Z]*|[^a-z]*|[a-zA-Z0-9]*)$/;
const filenameRegex = /^[\w\-. ]+$/;

const client = new MongoClient(config.get('mongodb.uri'));
client.connect()
.then(() => { console.log('Connected to MongoDB') })
.catch((error: Error) => { console.error('Error connecting to MongoDB: ', error) });
const db = client.db(config.get('mongodb.db_name'));
const companies = db.collection(config.get('mongodb.companies_collection'));
const users = db.collection(config.get('mongodb.users_collection'));
const storypoints = db.collection(config.get('mongodb.storypoints_collection'));
const jwt_token_blacklist = db.collection(config.get('mongodb.token_blacklist_collection'));
const files = db.collection(config.get('mongodb.fsgrid_files_collection') + '.files');

const bucket = new GridFSBucket(db, {
  bucketName: config.get('mongodb.fsgrid_files_collection')
})

if (!fs.existsSync(config.get('uploads_dir'))) {
  fs.mkdirSync(config.get('uploads_dir'));
  console.log('Uploads directory created');
} else {
  console.log('Uploads directory already exists');
}
const upload = multer({ dest: config.get('uploads_dir') });

if (!fs.existsSync(config.get('temp_dir'))) {
  fs.mkdirSync(config.get('temp_dir'));
  console.log('Temp directory created');
} else {
  console.log('Temp directory already exists');
}

app.use(express.json());
if (config.get('enable_cors')) {
  app.use(cors());
}
app.use((err: Error, req: Request, res: Response, next: any) => { 
  console.error('Error: ', err.stack);
  res.status(500).send('Something broke!');
})

async function hashPassword(password: string) {
  const saltRounds: number = config.get('bcrypt_salt_rounds')
  const salt = await bcrypt.genSalt(saltRounds)
  const hash = await bcrypt.hash(password, salt)
  return hash
}

async function comparePasswords(plainPwd: string, hashedPwd: string) {
  try {
      const match = await bcrypt.compare(plainPwd, hashedPwd);
      return match;
  } catch (error) {
      console.error('Error comparing passwords: ', error);
  }
}

async function getUnixTime() {
  return Math.floor(Date.now() / 1000)
}

async function companyExists(company_id: string, res: Response) {
  let company;
  try {
    company = await companies.findOne({ _id: new ObjectId(company_id) });
  } catch (error) {
    console.log('Error finding company by ID: ', error);
    res.status(500).send('Error finding company');
    return false
  }
  if (company === null) {
    res.status(404).send('Company not found');
    return false
  } 
  return true
}

async function storypointExists(company_id: string, res: Response) {
  let storypoint;
  try {
    storypoint = await storypoints.findOne({ _id: new ObjectId(company_id) });
  } catch (error) {
    console.log('Error finding storypoint by ID: ', error);
    res.status(500).send('Error finding storypoint');
    return false
  }
  if (storypoint === null) {
    res.status(404).send('Storypoint not found');
    return false
  }
  return true
}

async function checkEmail(email: string, res: Response) {
  if (await users.findOne({ email: email }) !== null) {
    res.status(409).send('Email already in use')
    return false;
  }
  if (config.get('enable_email_validation') && !emailRegex.test(email)) {
    res.status(400).send('Invalid email')
    return false;
  }
  return true;
}

async function checkPasssword(password: string, res: Response) {
  if (config.get('enable_password_validation') && passwordRegex.test(password)) {
    res.status(400).send('Invalid password')
    return false;
  }
  return true;
}

async function checkFilename(filename: any, res: Response) {
  if (typeof filename !== 'string') {
    res.status(400).send('Filename must be a string')
    return false;
  }
  if (config.get('enable_filename_validation') && !filenameRegex.test(filename)) {
    res.status(400).send('Invalid filename')
    return false;
  }
  return true;
}

async function verifyJWT(req: Request, res: Response) {
  if (!req.headers["authorization"]) {
    res.status(401).send('No auth token provided');
    return false;
  }
  if (await jwt_token_blacklist.findOne({ token: req.headers["authorization"] }) !== null) {
    res.status(401).send('Auth token blacklisted');
    return false;
  }
  try {
    const relevantToken = (req.headers["authorization"]).replace('Bearer ', "");
    const decoded = jwt.verify(relevantToken, config.get('jwt_secret')) as JwtPayload;
    req.user = {
      _id: decoded._id,
      email: decoded.email,
      fullname: '',
      password: '',
      created_at: 0,
      company_id: new ObjectId()
    };
    return true;
  } catch (error) {
    console.error('Error verifying JWT: ', error);
    res.status(401).send('Invalid auth token');
    return false;
  }
}

async function blacklistJWT(token: string) {
  if (await jwt_token_blacklist.findOne({ token: token }) !== null) {
    return
  }
  await jwt_token_blacklist.insertOne({ token: token })
}

async function calculateDistance(coordsA: Coordinates, coordsB: Coordinates) {
  const R = 6371; // earth radius in km
  const [latA, lonA] = coordsA;
  const [latB, lonB] = coordsB;
  const dLat = (latB - latA) * (Math.PI / 180);
  const dLon = (lonB - lonA) * (Math.PI / 180); 
  const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(latA * (Math.PI / 180)) * Math.cos(latB * (Math.PI / 180)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return distance; // in km
}

async function saveImageThumbnail(file_id: string, width: number, height: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const downloadStream = bucket.openDownloadStream(new ObjectId(file_id));
    const thumbnailPath = `${config.get('temp_dir')}/${file_id}`;
    const writeStream = fs.createWriteStream(`${thumbnailPath}.file`);

    downloadStream.on('error', (error: Error) => {
      console.error('Error downloading file from GridFS: ', error);
      reject(error);
    });

    writeStream.on('error', (error: Error) => {
      console.error('Error writing file to disk: ', error);
      reject(error);
    });

    writeStream.on('finish', async () => {
      try {
        await sharp(`${thumbnailPath}.file`)
            .resize(width, height)
            .toFile(`${thumbnailPath}`);
        resolve(thumbnailPath);
      } catch (error) {
        console.error('Error generating image thumbnail: ', error);
        reject(error);
      }
    });

    downloadStream.pipe(writeStream);
  });
}


app.get('/api', async (req: Request, res: Response) => {
  res.send('やった、GeoBase APIが動いてる!')
})

// user login via email and password
app.post('/api/login', async (req: Request, res: Response) => {
  const usr = await users.findOne({ email : req.body["user"].email })
  if (usr === null) {
    res.status(404).send('User not found')
    return
  }
  if (!await comparePasswords(req.body["user"].password, usr.password)) {
    res.status(401).send('Incorrect password')
    return
  }
  const token = jwt.sign({ _id: usr._id, email: usr.email }, config.get('jwt_secret'));
  res.json({ token: token });
})

// user login via email and password
app.post('/api/logout', async (req: Request, res: Response) => {
  if (!(await verifyJWT(req, res))) {
    return
  }
  await blacklistJWT(req.headers["authorization"] as string)
  res.send('User logged out')
})

// get user data
app.get('/api/user', async (req: Request, res: Response) => {
  if (!(await verifyJWT(req, res))) {
    return
  }
  req.user = req.user as User;
  let usr = await users.findOne({ _id: new ObjectId(req.user._id) })
  if (usr === null) {
    res.status(404).send('User not found')
    return
  }
  usr = {
    _id: usr._id,
    fullname: usr.fullname,
    email: usr.email,
    company_id: usr.company_id
  }
  res.json({"user": usr})
})

// get base data of companies storypoints
app.get('/api/company/:company_id/storypoints', async (req: Request, res: Response) => {
  if (!(await verifyJWT(req, res))) {
    return
  }
  req.user = req.user as User;
  if (!(await companyExists(req.params.company_id, res))) {
    return
  }
  if (!(await users.findOne({ _id: new ObjectId(req.user._id), company_id: new ObjectId(req.params.company_id) }))) {
    res.status(403).send('User not part of company')
    return
  }
  const spnts = await storypoints.find({ company_id: new ObjectId(req.params.company_id) }).toArray() as Storypoint[];
  const spntsStripped = spnts.map((spnt: Storypoint) => {
    return {
      _id: spnt._id,
      title: spnt.title,
      coords: spnt.coords
    }
  })
  res.json({"storypoints": spntsStripped})
})

// search company storypoints
app.get('/api/company/:company_id/storypoints/search', async (req: Request, res: Response) => {
  if (!req.query.q || typeof req.query.q !== 'string') {
    res.status(400).send('Missing search query')
    return
  }
  if (!(await verifyJWT(req, res))) {
    return
  }
  req.user = req.user as User;
  if (!(await companyExists(req.params.company_id, res))) {
    return
  }
  if (!(await users.findOne({ _id: new ObjectId(req.user._id), company_id: new ObjectId(req.params.company_id) }))) {
    res.status(403).send('User not part of company')
    return
  }
  const spnts = await storypoints.find({ company_id: new ObjectId(req.params.company_id) }).toArray()
  const fuse = new Fuse(spnts, config.get('fuseOptions'))
  const fuseResult = fuse.search(req.query.q, config.get('fuseSearchOptions'))
  const strippedResult = fuseResult.map((spnt: any) => {
    return {
      _id: spnt.item._id,
      title: spnt.item.title,
      coords: spnt.item.coords
    }
  })
  res.json({"storypoints": strippedResult})
})

// calculate nearby company storypoints
app.get('/api/company/:company_id/storypoints/nearby', async (req: Request, res: Response) => {
  if (!req.query.lat || !req.query.lng) {
    res.status(400).send('Missing coordinates')
    return
  }
  if (!(await verifyJWT(req, res))) {
    return
  }
  req.user = req.user as User;
  if (!(await companyExists(req.params.company_id, res))) {
    return
  }
  if (!(await users.findOne({ _id: new ObjectId(req.user._id), company_id: new ObjectId(req.params.company_id) }))) {
    res.status(403).send('User not part of company')
    return
  }
  const spntDocs = await storypoints.find({ company_id: new ObjectId(req.params.company_id) }).toArray()
  const coords: Coordinates = [parseFloat(req.query.lat as string), parseFloat(req.query.lng as string)]
  let spnts = await Promise.all(spntDocs.map(async (spntDoc: any) => {
    const distance = await calculateDistance(coords, spntDoc.coords)
    return {
      _id: spntDoc._id,
      title: spntDoc.title,
      coords: spntDoc.coords,
      distanceInKm: distance,
      distanceString: distance >= 1 ? `${distance.toFixed(1)} km` : `${Math.floor(distance * 1000)} m`
    }
  }))
  spnts.sort((a: { distanceInKm: number }, b: { distanceInKm: number }) => a.distanceInKm! - b.distanceInKm!)
  spnts = spnts.slice(0, config.get('nearby_search_storypoints_limit'))
  spnts.filter((spnt: { distanceInKm: number }) => spnt.distanceInKm! <= (config.get('nearby_search_storypoints_radius_km') as number))
  res.json({"storypoints": spnts})
})

// get full data of company storypoint
app.get('/api/company/:company_id/storypoints/:storypoint_id', async (req: Request, res: Response) => {
  if (!(await verifyJWT(req, res))) {
    return
  }
  req.user = req.user as User;
  if (!(await companyExists(req.params.company_id, res))) {
    return
  }
  if (!(await users.findOne({ _id: new ObjectId(req.user._id), company_id: new ObjectId(req.params.company_id) }))) {
    res.status(403).send('User not part of company')
    return
  }
  let spnt = await storypoints.findOne({ _id: new ObjectId(req.params.storypoint_id), company_id: new ObjectId(req.params.company_id) })
  if (spnt === null) {
    res.status(404).send('Storypoint not found')
    return
  }
  spnt = {
    _id: spnt._id,
    created_at: spnt.created_at,
    created_by: spnt.created_by,
    title: spnt.title,
    coords: spnt.coords,
    description: spnt.description,
    history: spnt.history
  }
  res.json({"storypoint": spnt})
})

// get base data of all company users
app.get('/api/company/:company_id/users', async (req: Request, res: Response) => {
  if (!(await verifyJWT(req, res))) {
    return
  }
  req.user = req.user as User;
  if (!(await companyExists(req.params.company_id, res))) {
    return
  }
  if (!(await users.findOne({ _id: new ObjectId(req.user._id), company_id: new ObjectId(req.params.company_id) }))) {
    res.status(403).send('User not part of company')
    return
  }
  let usrs = await users.find({ company_id: new ObjectId(req.params.company_id) }).toArray()
  usrs = usrs.map((usr: any) => {
    return {
      _id: usr._id,
      fullname: usr.fullname,
      email: usr.email
    }
  })
  res.json({"users": usrs})
})

// get company user
app.get('/api/company/:company_id/users/:user_id', async (req: Request, res: Response) => {
  if (!(await verifyJWT(req, res))) {
    return
  }
  req.user = req.user as User;
  if (!(await companyExists(req.params.company_id, res))) {
    return
  }
  if (!(await users.findOne({ _id: new ObjectId(req.user._id), company_id: new ObjectId(req.params.company_id) }))) {
    res.status(403).send('User not part of company')
    return
  }
  let usr = await users.findOne({ _id: new ObjectId(req.params.user_id), company_id: new ObjectId(req.params.company_id) })
  if (usr === null) {
    res.status(404).send('User not found')
    return
  }
  usr = {
    _id: usr._id,
    fullname: usr.fullname,
    email: usr.email
  }
  res.json({"user": usr})
})

// add company storypoint
app.post('/api/company/:company_id/storypoints', async (req: Request, res: Response) => {
  if (!(await verifyJWT(req, res))) {
    return
  }
  req.user = req.user as User;
  if (!(await companyExists(req.params.company_id, res))) {
    return
  }
  if (!(await users.findOne({ _id: new ObjectId(req.user._id), company_id: new ObjectId(req.params.company_id) }))) {
    res.status(403).send('User not part of company')
    return
  }
  if (await storypoints.findOne({ company_id: new ObjectId(req.params.company_id), coords: req.body["storypoint"].coords }) !== null) {
    res.status(409).send('Storypoint with these coordinates already exists')
    return
  }
  const spnt = {
    created_at: await getUnixTime(),
    created_by: new ObjectId(req.user._id),
    company_id: new ObjectId(req.params.company_id),
    coords: req.body["storypoint"].coords,
    title: req.body["storypoint"].title ? req.body["storypoint"].title : req.body["storypoint"].coords.toString(),
    description: req.body["storypoint"].description ? req.body["storypoint"].description : '',
    history: [],
    files: []
  }
  const insertRes = await storypoints.insertOne(spnt)
  const storypoint_id = insertRes.insertedId
  await companies.updateOne(
    { _id: new ObjectId(req.params.company_id) }, 
    { $push: { storypoint_ids: new ObjectId(storypoint_id) as any } }
  )
  res.status(201).json( {"storypoint_id": storypoint_id} )
})

// add company user
app.post('/api/company/:company_id/users', async (req: Request, res: Response) => {
  if (!(await companyExists(req.params.company_id, res))) {
    return
  }
  if (!(await verifyJWT(req, res))) {
    return
  }
  req.user = req.user as User;
  if (!(await users.findOne({ _id: new ObjectId(req.user._id), company_id: new ObjectId(req.params.company_id) }))) {
    res.status(403).send('Current user not part of company')
    return
  }
  if (await users.findOne({ company_id: new ObjectId(req.params.company_id), email: req.body["user"].email }) !== null) {
    res.status(409).send('User with this email already exists')
    return
  }
  if (!( await checkEmail(req.body["user"].email, res))) {
    return
  }
  if (!(await checkPasssword(req.body["user"].password, res))) {
    return
  }
  const usr = {
    created_at: await getUnixTime(),
    company_id: new ObjectId(req.params.company_id),
    fullname: req.body["user"].fullname,
    email: req.body["user"].email ? req.body["user"].email : '',
    password: await hashPassword(req.body["user"].password),
  }
  const insertRes = await users.insertOne(usr)
  const user_id = insertRes.insertedId
  await companies.updateOne(
    { _id: new ObjectId(req.params.company_id) }, 
    { $push: { user_ids: new ObjectId(user_id) as any } }
  )
  res.status(201).json({"user_id": user_id })
})

// register new company
app.post('/api/company', async (req: Request, res: Response) => {
  if (await verifyJWT(req, res)) {
    res.status(403).send('User already logged in')
    return
  }
  if (!( await checkEmail(req.body["company"].email, res))) {
    return
  }
  if (!(await checkPasssword(req.body["company"].password, res))) {
    return
  }
  if (await companies.findOne({ name: req.body["company"].name }) !== null) {
    res.status(409).send('Company with this name already exists')
    return
  }
  const company = {
    created_at: await getUnixTime(),
    name: req.body["company"].name,
    description: req.body["company"].description ? req.body["company"].description : '',
    storypoint_ids: [],
    user_ids: []
  }
  const insertResCmp = await companies.insertOne(company)
  const company_id = insertResCmp.insertedId

  const usr = {
    created_at: await getUnixTime(),
    company_id: new ObjectId(company_id),
    fullname: req.body["company"].fullname,
    email: req.body["company"].email,
    password: await hashPassword(req.body["company"].password),
  }
  const insertResUsr = await users.insertOne(usr)
  const user_id = insertResUsr.insertedId

  await companies.updateOne(
    { _id: new ObjectId(company_id) }, 
    { $push: { user_ids: new ObjectId(user_id) as any } }
  )
  const token = jwt.sign({ _id: user_id, email: usr.email }, config.get('jwt_secret'));

  res.status(201).json({"company_id": company_id, "user_id": user_id, "token": token })
})

// edit company storypoint
app.put('/api/company/:company_id/storypoints/:storypoint_id', async (req: Request, res: Response) => {
  if (!(await verifyJWT(req, res))) {
    return
  }
  req.user = req.user as User;
  if (!(await companyExists(req.params.company_id, res))) {
    return
  }
  if (!(await users.findOne({ _id: new ObjectId(req.user._id), company_id: new ObjectId(req.params.company_id) }))) {
    res.status(403).send('User not part of company')
    return
  }
  let spnt = await storypoints.findOne({ _id: new ObjectId(req.params.storypoint_id), company_id: new ObjectId(req.params.company_id) })
  if (spnt === null) {
    res.status(404).send('Storypoint not found')
    return
  }
  spnt = {
    ...spnt,
    title: req.body["storypoint"].title ? req.body["storypoint"].title : spnt.title,
    description: req.body["storypoint"].description ? req.body["storypoint"].description : spnt.description,
    coords: req.body["storypoint"].coords ? req.body["storypoint"].coords : spnt.coords,
    history: req.body["storypoint"].history ? req.body["storypoint"].history : spnt.history
  }
  await storypoints.updateOne(
    { _id: new ObjectId(req.params.storypoint_id), company_id: new ObjectId(req.params.company_id) },
    { $set: spnt }
  )
  res.send('Storypoint updated')
})

// edit company user
app.put('/api/company/:company_id/users/:user_id', async (req: Request, res: Response) => {
  if (!(await verifyJWT(req, res))) {
    return
  }
  req.user = req.user as User;
  if (!(await companyExists(req.params.company_id, res))) {
    return
  }
  if (!(await users.findOne({ _id: new ObjectId(req.user._id), company_id: new ObjectId(req.params.company_id) }))) {
    res.status(403).send('User not part of company')
    return
  }
  let usr = await users.findOne({ _id: new ObjectId(req.params.user_id), company_id: new ObjectId(req.params.company_id) })
  if (usr === null) {
    res.status(404).send('User not found')
    return
  }
  if (req.body["user"].email) {
    if (!(await checkEmail(req.body["user"].email, res))) {
      return
    }
    usr.email = req.body["user"].email
  }
  if (req.body["user"].password) {
    if (!(await checkPasssword(req.body["user"].password, res))) {
      return
    }
    usr.password = await hashPassword(req.body["user"].password)
  }
  usr = {
    ...usr,
    fullname: req.body["user"].fullname ? req.body["user"].fullname : usr.fullname
  }
  await users.updateOne(
    { _id: new ObjectId(req.params.user_id) },
    { $set: usr }
  )
  res.send('User updated')
})

// delete company storypoint
app.delete('/api/company/:company_id/storypoints/:storypoint_id', async (req: Request, res: Response) => {
  if (!(await verifyJWT(req, res))) {
    return
  }
  req.user = req.user as User;
  if (!(await companyExists(req.params.company_id, res))) {
    return
  }
  if (!(await users.findOne({ _id: new ObjectId(req.user._id), company_id: new ObjectId(req.params.company_id) }))) {
    res.status(403).send('User not part of company')
    return
  }
  const spnt = await storypoints.findOne({ _id: new ObjectId(req.params.storypoint_id), company_id: new ObjectId(req.params.company_id) })
  if (spnt === null) {
    res.status(404).send('Storypoint not found')
    return
  }
  await storypoints.deleteOne({ _id: new ObjectId(req.params.storypoint_id) })
  await companies.updateOne(
    { _id: new ObjectId(req.params.company_id) }, 
    { $pull: { storypoint_ids: new ObjectId(req.params.storypoint_id) as any } }
  )
  res.send('Storypoint deleted')
})

// delete company user
app.delete('/api/company/:company_id/users/:user_id', async (req: Request, res: Response) => {
  if (!(await verifyJWT(req, res))) {
    return
  }
  req.user = req.user as User;
  if (!(await companyExists(req.params.company_id, res))) {
    return
  }
  if (!(await users.findOne({ _id: new ObjectId(req.user._id), company_id: new ObjectId(req.params.company_id) }))) {
    res.status(403).send('User not part of company')
    return
  }
  const usr = await users.findOne({ _id: new ObjectId(req.params.user_id), company_id: new ObjectId(req.params.company_id) })
  if (usr === null) {
    res.status(404).send('User not found')
    return
  }
  await users.deleteOne({ _id: new ObjectId(req.params.user_id) })
  await companies.updateOne(
    { _id: new ObjectId(req.params.company_id) }, 
    { $pull: { user_ids: new ObjectId(req.params.user_id) as any } }
  )
  res.send('User deleted')
})

// Get Storypoint file list
app.get('/api/company/:company_id/storypoints/:storypoint_id/files', async (req: Request, res: Response) => {
  if (!(await verifyJWT(req, res))) {
    return
  }
  req.user = req.user as User;
  if (!(await companyExists(req.params.company_id, res))) {
    return
  }
  if (!(await users.findOne({ _id: new ObjectId(req.user._id), company_id: new ObjectId(req.params.company_id) }))) {
    res.status(403).send('User not part of company')
    return
  }
  const spnt = await storypoints.findOne({ _id: new ObjectId(req.params.storypoint_id), company_id: new ObjectId(req.params.company_id) })
  if (spnt === null) {
    res.status(404).send('Storypoint not found')
    return
  }
  const fileIds = spnt.files
  let sptnFiles = await files.find({ _id: { $in: fileIds } }).toArray()
  sptnFiles = sptnFiles.map((file: any) => {
    return {
      _id: file._id,
      filename: file.filename,
      created_by: file.created_by,
      filesize: file.length,
      created_at: file.uploadDate.getTime() / 1000
    }
  })
  res.json({ "files": sptnFiles })
})

// Upload file to Storypoint files
app.post('/api/company/:company_id/storypoints/:storypoint_id/files', upload.single('file'), async (req: Request, res: Response) => {
  if (!(await verifyJWT(req, res))) {
    return
  }
  req.user = req.user as User;
  if (!(await companyExists(req.params.company_id, res))) {
    return
  }
  if (!(await storypointExists(req.params.storypoint_id, res))) {
    return
  }
  if (!(await users.findOne({ _id: new ObjectId(req.user._id), company_id: new ObjectId(req.params.company_id) }))) {
    res.status(403).send('User not part of company')
    return
  }
  if (req.file.size > (config.get('max_upload_file_size') as number)) {
    res.status(400).send('File too large')
    return
  }
  if (!(await checkFilename(req.query.filename, res))) {
    return
  }
  if (await files.findOne({ filename: req.query.filename, storypoint_id: new ObjectId(req.params.storypoint_id) })) {
    res.status(409).send('File with that name already exists at the specified storypoint')
    return
  }

  const readStream = fs.createReadStream(req.file.path);
  const uploadStream = bucket.openUploadStream(req.query.filename as string);

  uploadStream.on('finish', () => {
    fs.unlinkSync(req.file.path);
    const fileId = uploadStream.id;

    files.updateOne({ _id: fileId }, {$set: 
      { 
        storypoint_id: new ObjectId(req.params.storypoint_id),
        company_id: new ObjectId(req.params.company_id),
        created_by: new ObjectId(req.user?._id)
      } 
    });

    storypoints.updateOne(
      { _id: new ObjectId(req.params.storypoint_id), company_id: new ObjectId(req.params.company_id) },
      { $push: { files: fileId } as any }
    )

    res.send('File uploaded successfully');
  });

  uploadStream.on('error', () => {
    res.status(500).send('Error uploading file');
  });

  readStream.pipe(uploadStream);
});

// Download storypoint files as archive (zip)
app.get('/api/company/:company_id/storypoints/:storypoint_id/files/archive', async (req: Request, res: Response) => {
  if (!(await verifyJWT(req, res))) {
    return
  }
  req.user = req.user as User;
  if (!(await companyExists(req.params.company_id, res))) {
    return
  }
  if (!(await storypointExists(req.params.storypoint_id, res))) {
    return
  }
  if (!(await users.findOne({ _id: new ObjectId(req.user._id), company_id: new ObjectId(req.params.company_id) }))) {
    res.status(403).send('User not part of company')
    return
  }
  const spnt = await storypoints.findOne({ _id: new ObjectId(req.params.storypoint_id), company_id: new ObjectId(req.params.company_id) })
  if (spnt === null) {
    res.status(404).send('Storypoint not found')
    return
  }

  const sptnFiles = await files.find({ _id: { $in: spnt.files } }).toArray()

  const zipPath = `${config.get('temp_dir')}/${req.params.storypoint_id}.zip`
  const output = fs.createWriteStream(zipPath)
  const archive = archiver(config.get('archiver_format'), {
    zlib: { level: config.get('archiver_compression_level') }
  })

  output.on('close', () => {
    res.download(zipPath, `${spnt.title}.zip`, () => {
      fs.unlinkSync(zipPath)
    })
  })

  archive.pipe(output)

  sptnFiles.forEach((file: any) => {
    const downloadStream = bucket.openDownloadStream(new ObjectId(file._id))
    archive.append(downloadStream, { name: file.filename })
  })

  archive.finalize()
})

// Download file from Storypoint files
app.get('/api/company/:company_id/storypoints/:storypoint_id/files/:file_id', async (req: Request, res: Response) => {
  if (!(await verifyJWT(req, res))) {
    return
  }
  req.user = req.user as User;
  if (!(await companyExists(req.params.company_id, res))) {
    return
  }
  if (!(await storypointExists(req.params.storypoint_id, res))) {
    return
  }
  if (!(await users.findOne({ _id: new ObjectId(req.user._id), company_id: new ObjectId(req.params.company_id) }))) {
    res.status(403).send('User not part of company')
    return
  }
  if (!(await files.findOne({ _id: new ObjectId(req.params.file_id), storypoint_id: new ObjectId(req.params.storypoint_id), company_id: new ObjectId(req.params.company_id)}))) {
    res.status(404).send('File not found at this storypoint')
    return
  }
  const downloadStream = bucket.openDownloadStream(new ObjectId(req.params.file_id))

  downloadStream.on('error', () => {
    res.status(500).send('Error downloading file');
  });

  downloadStream.pipe(res);
});

// Delete file from Storypoint files
app.delete('/api/company/:company_id/storypoints/:storypoint_id/files/:file_id', async (req: Request, res: Response) => {
  if (!(await verifyJWT(req, res))) {
    return
  }
  req.user = req.user as User;
  if (!(await companyExists(req.params.company_id, res))) {
    return
  }
  if (!(await storypointExists(req.params.storypoint_id, res))) {
    return
  }
  if (!(await users.findOne({ _id: new ObjectId(req.user._id), company_id: new ObjectId(req.params.company_id) }))) {
    res.status(403).send('User not part of company')
    return
  }
  if (!(await files.findOne({ _id: new ObjectId(req.params.file_id), storypoint_id: new ObjectId(req.params.storypoint_id), company_id: new ObjectId(req.params.company_id)}))) {
    res.status(404).send('File not found at this storypoint')
    return
  }
  await files.deleteOne({ _id: new ObjectId(req.params.file_id) })
  await storypoints.updateOne(
    { _id: new ObjectId(req.params.storypoint_id), company_id: new ObjectId(req.params.company_id) },
    { $pull: { files: new ObjectId(req.params.file_id) } as any }
  )
  res.send('File deleted')
});

// Download file thumbnail from Storypoint files
app.get('/api/company/:company_id/storypoints/:storypoint_id/files/:file_id/thumbnail', async (req: Request, res: Response) => {
  if (!(await verifyJWT(req, res))) {
    return
  }
  req.user = req.user as User;
  if (!(await companyExists(req.params.company_id, res))) {
    return
  }
  if (!(await storypointExists(req.params.storypoint_id, res))) {
    return
  }
  if (!(await users.findOne({ _id: new ObjectId(req.user._id), company_id: new ObjectId(req.params.company_id) }))) {
    res.status(403).send('User not part of company')
    return
  }
  const file = await files.findOne({ _id: new ObjectId(req.params.file_id), storypoint_id: new ObjectId(req.params.storypoint_id), company_id: new ObjectId(req.params.company_id)})
  if (!(file)) {
    res.status(404).send('File not found at this storypoint')
    return
  } 
  if (!(config.get('image_file_endings') as string[]).some((ending: string) => file.filename.toLowerCase().endsWith(ending.toLowerCase()))) {
    res.status(400).send('File is not an image type')
    return
  }
  
  let thumbnailPath: string = '';
  try {
    thumbnailPath = await saveImageThumbnail(req.params.file_id, config.get('thumbnail_width'), config.get('thumbnail_height'))
  } catch (error) {
    console.error('Error generating image thumbnail: ', error);
    res.status(500).send('Error generating image thumbnail')
    return
  }
  
  const downloadStream = fs.createReadStream(thumbnailPath);

  downloadStream.on('error', () => {
    res.status(500).send('Error downloading image thumbnail');
    fs.unlinkSync(thumbnailPath);
  });

  downloadStream.on('close', () => {
    fs.unlinkSync(thumbnailPath);
  });

  downloadStream.pipe(res);
})

// Rename file from Storypoint files
app.put('/api/company/:company_id/storypoints/:storypoint_id/files/:file_id/rename', async (req: Request, res: Response) => {
  if (!(await verifyJWT(req, res))) {
    return
  }
  req.user = req.user as User;
  if (!(await companyExists(req.params.company_id, res))) {
    return
  }
  if (!(await storypointExists(req.params.storypoint_id, res))) {
    return
  }
  if (!(await users.findOne({ _id: new ObjectId(req.user._id), company_id: new ObjectId(req.params.company_id) }))) {
    res.status(403).send('User not part of company')
    return
  }
  if (await files.findOne({ filename: req.body["file"].filename, storypoint_id: new ObjectId(req.params.storypoint_id), company_id: new ObjectId(req.params.company_id)})) {
    res.status(409).send('File with that name already exists at the specified storypoint')
    return
  }
  if (!(await checkFilename(req.body["file"].filename, res))) {
    return
  }
  await files.updateOne(
    { _id: new ObjectId(req.params.file_id) },
    { $set: { filename: req.body["file"].filename } }
  )
  res.send('File renamed')
})


app.listen(config.get('port'), () => {
  console.log(`GeoBase listening on port ${config.get('port')}!`)
})
