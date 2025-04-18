# GeoBase

**GeoBase** is the backend service powering [GeoStorage](https://github.com/alessioC42/GeoStorage). It handles all the heavy lifting like data storage, API endpoints, and user auth.
GeoStorage is tool developed for a three day hackathon with [@alessioC42](https://github.com/alessioC42/). 

---

### Getting Started

Clone the repo and install dependencies:

```bash
git clone https://github.com/SirPythonPhoenix/GeoBase/
cd GeoBase
npm install
```

Make sure you have **MongoDB** running locally, or point to a remote MongoDB instance in the config file.

To start the development server:

```bash
npm run dev
```

---

### Production Setup

Before running GeoBase in production, you’ll need to build the project:

```bash
npm run build
```

Then, use these commands to manage the server (uses [PM2](https://pm2.keymetrics.io/)):

```bash
npm run start      # Start the server
npm run restart    # Restart the server
npm run stop       # Stop the server
```

Feel free to tweak these scripts to fit your setup.

> **Note:** If you're exposing GeoBase to the web, make sure to use HTTPS (SSL/TLS) to keep data secure.

---

### Configuration

Default settings are in `config/default.json`. To customize:

1. Create a file named `config/local.json`
2. Add or override the values you want to change.

Example:

```json
{
  "port": 9999,
  "jwt_secret": "my_super_secret_key"
}
```

---

### Setting a JWT Secret

Need a secure JWT secret? Generate one like this:

```bash
gpg --armor --gen-random 2 32
```

Copy the output and paste it into your `config/local.json` under `jwt_secret`.

---

### That’s it!

You're all set. Go build something cool with GeoBase.

Happy mapping! 🗺️
