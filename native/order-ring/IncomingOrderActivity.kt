package com.zepmed.seller

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class IncomingOrderActivity : Activity() {
  private val dismissReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (intent?.action == IncomingOrderNotifier.ACTION_DISMISS) finish()
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= 27) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    }
    @Suppress("DEPRECATION")
    window.addFlags(
      WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        or WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
        or WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
        or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
    )
    val filter = IntentFilter(IncomingOrderNotifier.ACTION_DISMISS)
    if (Build.VERSION.SDK_INT >= 33) {
      registerReceiver(dismissReceiver, filter, RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("UnspecifiedRegisterReceiverFlag")
      registerReceiver(dismissReceiver, filter)
    }

    val orderId = intent.getIntExtra(IncomingOrderNotifier.EXTRA_ORDER, 0)
    val title = intent.getStringExtra(IncomingOrderNotifier.EXTRA_TITLE) ?: "New order"
    val body = intent.getStringExtra(IncomingOrderNotifier.EXTRA_BODY) ?: "Open the seller app to accept"

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(Color.parseColor("#0F766E"))
      gravity = Gravity.CENTER
      setPadding(48, 96, 48, 96)
    }
    val heading = TextView(this).apply {
      text = title
      setTextColor(Color.WHITE)
      textSize = 26f
      gravity = Gravity.CENTER
    }
    val detail = TextView(this).apply {
      text = body
      setTextColor(Color.parseColor("#CCFBF1"))
      textSize = 18f
      gravity = Gravity.CENTER
      setPadding(0, 24, 0, 64)
    }
    val open = Button(this).apply {
      text = "Open order"
      setBackgroundColor(Color.parseColor("#16A34A"))
      setTextColor(Color.WHITE)
      setOnClickListener { openOrder(orderId) }
    }
    val silence = Button(this).apply {
      text = "Silence"
      setBackgroundColor(Color.parseColor("#134E4A"))
      setTextColor(Color.WHITE)
      setOnClickListener {
        IncomingOrderNotifier.mute(this@IncomingOrderActivity, orderId)
        IncomingOrderNotifier.dismiss(this@IncomingOrderActivity)
        finish()
      }
    }
    val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
      topMargin = 24
    }
    root.addView(heading)
    root.addView(detail)
    root.addView(open, lp)
    root.addView(silence, lp)
    setContentView(root)
  }

  private fun openOrder(orderId: Int) {
    IncomingOrderNotifier.dismiss(this)
    if (orderId > 0) startActivity(IncomingOrderNotifier.openIntent(this, orderId))
    finish()
  }

  override fun onDestroy() {
    try { unregisterReceiver(dismissReceiver) } catch (_: Exception) {}
    super.onDestroy()
  }
}
