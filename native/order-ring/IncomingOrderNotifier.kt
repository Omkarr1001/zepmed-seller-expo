package com.zepmed.seller

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat

object IncomingOrderNotifier {
  const val CHANNEL = "zepmed-seller-orders"
  const val NOTIFY_ID = 5104
  const val EXTRA_ORDER = "order_id"
  const val EXTRA_TITLE = "order_title"
  const val EXTRA_BODY = "order_body"
  const val ACTION_OPEN = "com.zepmed.seller.ORDER_OPEN"
  const val ACTION_SILENCE = "com.zepmed.seller.ORDER_SILENCE"
  const val ACTION_DISMISS = "com.zepmed.seller.ORDER_DISMISS"
  private const val PREFS = "zepmed_seller_ring"
  private const val KEY_LOGGED_IN = "logged_in"
  private const val KEY_SOUND = "sound_enabled"
  private const val KEY_MUTED = "muted_ids"
  private const val KEY_CHANNEL = "channel_alert_v3"

  @Volatile var appActive: Boolean = false
  @Volatile private var player: MediaPlayer? = null
  @Volatile private var vibrator: Vibrator? = null
  @Volatile private var wakeLock: PowerManager.WakeLock? = null
  @Volatile private var generation: Int = 0

  fun isLoggedIn(ctx: Context): Boolean =
    prefs(ctx).getBoolean(KEY_LOGGED_IN, false)

  fun setLoggedIn(ctx: Context, loggedIn: Boolean) {
    prefs(ctx).edit().putBoolean(KEY_LOGGED_IN, loggedIn).commit()
    if (!loggedIn) dismiss(ctx)
  }

  fun setSoundEnabled(ctx: Context, enabled: Boolean) {
    prefs(ctx).edit().putBoolean(KEY_SOUND, enabled).commit()
    if (!enabled) dismiss(ctx)
  }

  fun soundEnabled(ctx: Context): Boolean =
    prefs(ctx).getBoolean(KEY_SOUND, true)

  fun show(ctx: Context, orderId: Int, title: String, body: String) {
    if (orderId <= 0) return
    if (!isLoggedIn(ctx) || !soundEnabled(ctx)) {
      dismiss(ctx)
      return
    }
    if (isMuted(ctx, orderId)) return
    val gen = ++generation
    ensureChannel(ctx)
    wake(ctx)
    startOrderAlert(ctx, gen)
    vibrate(ctx)

    val full = Intent(ctx, IncomingOrderActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
      putExtra(EXTRA_ORDER, orderId)
      putExtra(EXTRA_TITLE, title)
      putExtra(EXTRA_BODY, body)
    }
    val fullPi = PendingIntent.getActivity(
      ctx, orderId + 900, full,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val openPi = PendingIntent.getActivity(
      ctx, orderId + 901, openIntent(ctx, orderId),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val openAction = PendingIntent.getBroadcast(
      ctx, orderId + 902,
      Intent(ctx, IncomingOrderReceiver::class.java).setAction(ACTION_OPEN).putExtra(EXTRA_ORDER, orderId),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val silenceAction = PendingIntent.getBroadcast(
      ctx, orderId + 903,
      Intent(ctx, IncomingOrderReceiver::class.java).setAction(ACTION_SILENCE).putExtra(EXTRA_ORDER, orderId),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val builder = NotificationCompat.Builder(ctx, CHANNEL)
      .setSmallIcon(ctx.applicationInfo.icon)
      .setContentTitle(title)
      .setContentText(body)
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setAutoCancel(false)
      .setVibrate(longArrayOf(0, 280, 120, 280))
      .setSilent(true)
      .setFullScreenIntent(fullPi, true)
      .setContentIntent(openPi)
      .addAction(0, "Silence", silenceAction)
      .addAction(0, "Open", openAction)
      .setTimeoutAfter(90_000)
    val notification = builder.build()
    notification.flags = notification.flags or Notification.FLAG_NO_CLEAR
    ctx.getSystemService(NotificationManager::class.java).notify(NOTIFY_ID, notification)
    Handler(Looper.getMainLooper()).postDelayed({
      if (generation == gen) dismiss(ctx.applicationContext)
    }, 90_000)
  }

  fun openIntent(ctx: Context, orderId: Int): Intent {
    return Intent(Intent.ACTION_VIEW, Uri.parse("zepmedseller://order/$orderId")).apply {
      setPackage(ctx.packageName)
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
      putExtra(EXTRA_ORDER, orderId)
    }
  }

  fun dismiss(ctx: Context) {
    generation += 1
    stopOrderAlert()
    stopVibrate(ctx)
    try { ctx.getSystemService(NotificationManager::class.java).cancel(NOTIFY_ID) } catch (_: Exception) {}
    try { wakeLock?.let { if (it.isHeld) it.release() } } catch (_: Exception) {}
    wakeLock = null
    try {
      ctx.sendBroadcast(Intent(ACTION_DISMISS).setPackage(ctx.packageName))
    } catch (_: Exception) {}
  }

  fun mute(ctx: Context, orderId: Int) {
    if (orderId <= 0) return
    val next = HashSet(prefs(ctx).getStringSet(KEY_MUTED, emptySet()) ?: emptySet())
    next.add(orderId.toString())
    prefs(ctx).edit().putStringSet(KEY_MUTED, next).commit()
  }

  fun unmute(ctx: Context, orderId: Int) {
    if (orderId <= 0) return
    val next = HashSet(prefs(ctx).getStringSet(KEY_MUTED, emptySet()) ?: emptySet())
    next.remove(orderId.toString())
    prefs(ctx).edit().putStringSet(KEY_MUTED, next).commit()
  }

  fun syncMuted(ctx: Context, ids: Collection<Int>) {
    val next = HashSet<String>()
    for (id in ids) if (id > 0) next.add(id.toString())
    prefs(ctx).edit().putStringSet(KEY_MUTED, next).commit()
  }

  fun isMuted(ctx: Context, orderId: Int): Boolean {
    if (orderId <= 0) return false
    val muted = prefs(ctx).getStringSet(KEY_MUTED, emptySet()) ?: emptySet()
    return muted.contains(orderId.toString())
  }

  fun ensureChannel(ctx: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    val nm = ctx.getSystemService(NotificationManager::class.java)
    val store = prefs(ctx)
    if (!store.getBoolean(KEY_CHANNEL, false)) {
      nm.deleteNotificationChannel(CHANNEL)
      store.edit().putBoolean(KEY_CHANNEL, true).commit()
    }
    val want = alertUri(ctx)
    val existing = nm.getNotificationChannel(CHANNEL)
    val wrongSound = existing != null && existing.sound != want
    if (existing != null && !wrongSound && existing.importance >= NotificationManager.IMPORTANCE_HIGH) return
    if (existing != null) nm.deleteNotificationChannel(CHANNEL)
    val channel = NotificationChannel(CHANNEL, "ZepMed seller orders", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "Short order alert when a new order arrives, even if the app is closed"
      enableVibration(true)
      vibrationPattern = longArrayOf(0, 280, 120, 280)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      setBypassDnd(true)
      setSound(
        want,
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_NOTIFICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
      )
    }
    nm.createNotificationChannel(channel)
  }

  private fun prefs(ctx: Context) =
    ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun alertUri(ctx: Context): Uri =
    Uri.parse("android.resource://${ctx.packageName}/raw/order_bell")

  private fun startOrderAlert(ctx: Context, gen: Int) {
    stopOrderAlert()
    try {
      val mp = MediaPlayer()
      mp.setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_NOTIFICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
      )
      mp.setDataSource(ctx.applicationContext, alertUri(ctx))
      mp.isLooping = false
      mp.setOnCompletionListener {
        if (player === it) {
          it.release()
          player = null
        }
      }
      mp.setOnErrorListener { errored, _, _ ->
        try { errored.release() } catch (_: Exception) {}
        if (player === errored) player = null
        true
      }
      mp.prepare()
      if (generation != gen) {
        mp.release()
        return
      }
      mp.start()
      player = mp
    } catch (_: Exception) {}
  }

  private fun stopOrderAlert() {
    val current = player
    player = null
    try {
      current?.stop()
      current?.release()
    } catch (_: Exception) {}
  }

  @Suppress("DEPRECATION")
  private fun wake(ctx: Context) {
    try {
      val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
      val flags = PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP
      val lock = pm.newWakeLock(flags, "zepmed:incoming-order")
      lock.acquire(45_000)
      wakeLock = lock
    } catch (_: Exception) {}
  }

  @Suppress("DEPRECATION")
  private fun vibrate(ctx: Context) {
    try {
      val pattern = longArrayOf(0, 280, 120, 280, 120, 280)
      val device = if (Build.VERSION.SDK_INT >= 31) {
        ctx.getSystemService(VibratorManager::class.java).defaultVibrator
      } else {
        ctx.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
      }
      vibrator = device
      if (Build.VERSION.SDK_INT >= 26) device.vibrate(VibrationEffect.createWaveform(pattern, -1))
      else device.vibrate(pattern, -1)
    } catch (_: Exception) {}
  }

  private fun stopVibrate(ctx: Context) {
    try { vibrator?.cancel() } catch (_: Exception) {}
    vibrator = null
    try {
      if (Build.VERSION.SDK_INT >= 31) {
        ctx.getSystemService(VibratorManager::class.java).defaultVibrator.cancel()
      } else {
        @Suppress("DEPRECATION")
        (ctx.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator).cancel()
      }
    } catch (_: Exception) {}
  }
}
