// allfunc/voiceChat.js
const { InworldClient } = require('@inworld/node-sdk');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

class InworldVoiceSession {
  /**
   * @param {string} chatId - WhatsApp ch
   */
  constructor(chatId, devtrust) {
    this.chatId = chatId;
    this.devtrust = devtrust;   // we'll use this to send messages
    this.client = null;
    this.isActive = false;at ID
   * @param {object} devtrust - Your bot's socket (devtrust)
  }

  /**
   * Start the Inworld connection
   */
  async start() {
    try {
      this.client = new InworldClient({
        apiKey: process.env.INWORLD_API_KEY,
      })
        .setConfiguration({
          capabilities: {
            audio: true,          // enable audio streaming
            emotions: false,       // we don't need emotions
            interruptions: true,   // allow barge-in
          },
          audio: {
            input: {
              encoding: 'pcm_mulaw',
              sampleRate: 8000,
            },
            output: {
              encoding: 'pcm_mulaw',
              sampleRate: 8000,
            },
          },
        })
        .setUser({ fullName: 'WhatsApp User' })
        .setScene('characters')   // optional: specify a character
        .build();

      // Handle incoming text (for debugging)
      this.client.on('text', (text) => {
        console.log(`[Inworld][${this.chatId}] ${text}`);
      });

      // Handle incoming audio chunks
      this.client.on('audio', async (audioChunk) => {
        await this.sendAudioReply(audioChunk);
      });

      // Handle disconnection
      this.client.on('disconnect', () => {
        console.log(`[Voice] Session ended for ${this.chatId}`);
        this.isActive = false;
      });

      await this.client.connect();
      this.isActive = true;
      console.log(`[Voice] Session started for ${this.chatId}`);
    } catch (error) {
      console.error(`[Voice] Failed to start session for ${this.chatId}:`, error);
      throw error;
    }
  }

  /**
   * Convert Inworld's PCM mu‑law to MP3 and send as voice note using devtrust
   * @param {Buffer} pcmAudio - raw PCM mu‑law audio at 8kHz
   */
  async sendAudioReply(pcmAudio) {
    const inputPath = path.join(__dirname, `temp_in_${Date.now()}.raw`);
    const outputPath = path.join(__dirname, `temp_out_${Date.now()}.mp3`);

    try {
      fs.writeFileSync(inputPath, pcmAudio);

      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .inputFormat('mulaw')
          .audioFrequency(8000)
          .audioChannels(1)
          .toFormat('mp3')
          .on('end', resolve)
          .on('error', reject)
          .save(outputPath);
      });

      const mp3Buffer = fs.readFileSync(outputPath);

      // Use devtrust to send the audio as a voice note
      await this.devtrust.sendMessage(this.chatId, {
        audio: mp3Buffer,
        mimetype: 'audio/mpeg',
        ptt: true,                // send as voice note
      });
    } catch (error) {
      console.error('[Voice] Error sending audio reply:', error);
    } finally {
      // Cleanup temporary files
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    }
  }

  /**
   * Process a user's voice note (WhatsApp audio) and send to Inworld
   * @param {Buffer} audioBuffer - WhatsApp audio (Opus/Ogg)
   */
  async processVoiceNote(audioBuffer) {
    if (!this.isActive || !this.client) return;

    const inputPath = path.join(__dirname, `voice_in_${Date.now()}.ogg`);
    const outputPath = path.join(__dirname, `voice_out_${Date.now()}.raw`);

    try {
      fs.writeFileSync(inputPath, audioBuffer);

      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .audioCodec('pcm_mulaw')
          .audioFrequency(8000)
          .audioChannels(1)
          .format('mulaw')
          .on('end', resolve)
          .on('error', reject)
          .save(outputPath);
      });

      const pcmBuffer = fs.readFileSync(outputPath);

      // Send to Inworld
      this.client.sendAudio(pcmBuffer);
    } catch (error) {
      console.error('[Voice] Error processing voice note:', error);
    } finally {
      // Cleanup
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    }
  }

  /**
   * Stop the session
   */
  stop() {
    if (this.client) {
      this.client.close();
    }
    this.isActive = false;
  }
}

module.exports = InworldVoiceSession;