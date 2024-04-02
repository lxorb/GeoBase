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

For production, use:

```bash
npm run prod
```

Feel free to configure those commands to your needs.
When exposing the backend, it's important to utilize encryption via SSL/TLS to protect user data and prevent potential data leaks.

### Configuration

GeoBase comes with standard configuration values, which can be found in `config/default.json`. However, you may need to customize these values according to your specific requirements. To do so, follow these steps:

1. Create a new file at `config/local.json`.
2. Specify the corresponding values you wish to overwrite in `config/local.json`.
3. For example:
```json
{
  "port": 9999,
  "jwt_secret": "my_new_secret"
}
```

### Specifying a jwt secret

You have already seen how to modify the config depending on your needs. We strongly recommend to change the jwt secret. To do so, run the following command:

```bash
gpg --armor --gen-random 2 32
```

Copy stdout to your clipboard and adjust the config-file. You're ready to go now!

### Final word

Happy mapping! 🌍
