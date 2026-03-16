const fs = require('fs')

global.owner = "234" //owner number
global.footer = "Cyber Space" //footer section
global.status = false //"self/public" section of the bot
global.prefa = ['','!','.',',','🐤','🗿']
global.owner = ['62']
global.xprefix = '.'
global.gambar = "https://files.catbox.moe/13l2la.jpg"
global.OWNER_NAME = "@Cyberspace_officials" //
global.DEVELOPER = ["2348126874661"] //
global.BOT_NAME = "Cyber Space Mini Bot"
global.bankowner = "Cyber Space Mini md"
global.creatorName = "Cyber Space Mini md"
global.ownernumber = '2348126874661'  //creator number
global.location = "Nigeria,kwara"
global.prefa = ['','!','.','#','&']
//================DO NOT CHANGE OR YOU'LL GET AN ERROR=============\
global.footer = "Queen Leesha mini md" //footer section
global.link = "https://chat.whatsapp.com/DwJU5cR2wrR9j4EutumEDp?mode=ems_copy_t"
global.autobio = true//auto update bio
global.botName = "Queen Leesha mini md"
global.version = "1.0.1"
global.botname = "Queen Leesha mini md"
global.author = "Kallmetrust "
global.themeemoji = "🥷"
global.wagc = 'https://chat.whatsapp.com/DwJU5cR2wrR9j4EutumEDp?mode=ems_copy_t'
global.thumbnail = 'https://files.catbox.moe/13l2la.jpg'
global.richpp = ' '
global.packname = "Sticker By Mrs Trust"
global.author = "Kallmetrust "
global.creator = "2349155604141@s.whatsapp.net"
global.ownername = 'Trust ' 
global.onlyowner = `Only Kallmetrust  can use this Command 💜🥷`
  // reply 
global.database = `*To Exist In The Database Contact The Owner of this bot*`
  global.mess = {
wait: "*Configurating.......*",
   success: "*Successfully acknowledged ☑️*",
   on: "*Activated ✅*", 
   prem: "*Feature For Premium Users only*", 
   off: "*Deactivated 📛*",
   query: {
       text: "*Please, Provide A Text Query 📑*",
       link: "Please, provide a valid link 🔗*",
   },
   error: {
       fitur: "*Status 🌐: Feature Or Command error ❌*",
   },
   only: {
       group: "*Group only feature ❌*",
private: "*Private chat feature only ❌*",
       owner: "*Owner feature only ❌*",
       admin: "*bot owner feature only ❌*",
       badmin: "*Seek admin privilege's to use this command ❌*",
       premium: "*Availabe for premium users only ❌*",
   }
}

global.hituet = 0
//false=disable and true=enable
global.autoviewstatus = false
global.autoread = false //auto read messages
global.autobio = true //auto update bio
global.anti92 = true //auto block +92 
global.autoswview = true //auto view status/story

let file = require.resolve(__filename)
require('fs').watchFile(file, () => {
  require('fs').unwatchFile(file)
  console.log('\x1b[0;32m'+__filename+' \x1b[1;32mupdated!\x1b[0m')
  delete require.cache[file]
  require(file)
})

//Property of Kallmetrust  
//owner number:+234902009026
//telegram :@Rfxdx
