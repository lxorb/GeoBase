# GeoBase

Welcome to GeoBase, your go-to solution for geographical data handling. 

### Getting Started

To get started, first run the following commands to create a directory and load the repo.

```bash
git clone "https://github.com/SirPythonPhoenix/GeoBase/"
cd GeoBase
npm install
```
Next up, use the following command to start a local dev-server. 
You need to have mongodb set up and running or reference an external mongodb-server via the config file.

```bash
npm run dev
```

### Configuration

GeoBase comes with standard configuration values, which can be found in `/config/default.json`. However, you may need to customize these values according to your specific requirements. To do so, follow these steps:

1. Create a new file at `config/local.json`.
2. Specify the corresponding values you wish to overwrite in local.json.
3. For example:
```json
{
  "port": 9999,
  "resave_sessions": true
}
```

### Final word

Happy mapping! 🌍
