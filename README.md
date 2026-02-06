---
title: 8stream Api
emoji: 🚀
colorFrom: blue
colorTo: red
sdk: docker
pinned: false
---

![8-stream-high-resolution-logo-transparent](https://github.com/himanshu8443/HayasakaStream/assets/99420590/813cca3a-a3c3-4f40-8a79-df5b866edf68)
 - Api provides Movies/Series streaming links by IMDB IDs.
 - Most commonly provided languages - Hindi, English, Tamil, Telugu, Bengali.

#  Documentation
## Get media Info
Provides information file and key which is used to get steram link.
 
**Endpoint** - `/api/v1/mediaInfo?id=tt1877830`

**Response** - 
```
{
    "success": true,
    "data": {
        "playlist": [
            {
                "title": "Hindi",
                "id": "24b8c045e7fcd28fb2ee654de75a5771",
                "file": "..."
            }
        ],
        "key": "..."
    }
}
```

# Installation
  ```
   git clone https://github.com/himanshu8443/8StreamApi.git
  ```

 ```
   cd 8StreamApi
```
 ### node
  ```
   npm install
   npm run build
   npm run start
```
   
###  docker
```
docker build -t 8streamapi .
```
```
docker run -p 7860:7860 -it -d 8streamapi
```
