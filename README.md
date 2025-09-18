# Pcc-photohub

This is a Next.js Photobooth project Combind with Python3 for camera backed

## Using the project

You have to host your own [MongoDB](https://www.mongodb.com/) and [nextcloud](https://nextcloud.com/) Settup and ready before follow this guide

Also ensure that your system have [Nodejs](https://nextjs.org), [Python3](https://www.python.org/) setup already

First, install the python requirements using [Python virtual environment](https://virtualenv.pypa.io/en/latest/)

```bash
python3 -m venv .venv
source .venv/bin/activate
```

Then use [pip](https://pip.pypa.io/en/stable/) to install requirement.

```bash
pip3 install -r requirements.txt
```

then install nodejs requirements by

```bash
npm install
npm run install:all
```

Lastly setup your .env by using [dotenvtemplate](dotenvtemplate)

### Starting sequent

```bash
python3 usbcam.py #or ref.py for dslr mirrorless camera
```
open new terminal tab then run
```bash
npm run dev  
```
Open [http://localhost:3000/booth](http://localhost:3000/booth) with your browser.


## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [Geist](https://vercel.com/font) - a new font family for Vercel
- [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) - automatically optimize and load

## Debbuging
api test is avaible at 
```bash
cd photobootAPI/examples/web-demo
npx http-server -p 5173 .
```
editing the page by modifying [app/booth/page.tsx](app/booth/page.js) The page will auto-updates as you edit the file.