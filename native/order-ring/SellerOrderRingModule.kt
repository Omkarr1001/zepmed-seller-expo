package com.zepmed.seller

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.modules.core.DeviceEventManagerModule

class SellerOrderRingModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName() = "SellerOrderRing"

  override fun initialize() {
    super.initialize()
    SellerOrderRingModule.attach(reactContext)
  }

  override fun invalidate() {
    SellerOrderRingModule.detach(reactContext)
    super.invalidate()
  }

  @ReactMethod
  fun setSession(loggedIn: Boolean) {
    IncomingOrderNotifier.setLoggedIn(reactContext, loggedIn)
  }

  @ReactMethod
  fun setSoundEnabled(enabled: Boolean) {
    IncomingOrderNotifier.setSoundEnabled(reactContext, enabled)
  }

  @ReactMethod
  fun setAppActive(active: Boolean) {
    IncomingOrderNotifier.appActive = active
  }

  @ReactMethod
  fun show(orderId: Double, title: String, body: String) {
    IncomingOrderNotifier.show(reactContext, orderId.toInt(), title, body)
  }

  @ReactMethod
  fun dismiss() {
    IncomingOrderNotifier.dismiss(reactContext)
  }

  @ReactMethod
  fun mute(orderId: Double) {
    IncomingOrderNotifier.mute(reactContext, orderId.toInt())
  }

  @ReactMethod
  fun unmute(orderId: Double) {
    IncomingOrderNotifier.unmute(reactContext, orderId.toInt())
  }

  @ReactMethod
  fun syncMuted(ids: ReadableArray) {
    val parsed = ArrayList<Int>()
    for (i in 0 until ids.size()) {
      val id = when (ids.getType(i)) {
        com.facebook.react.bridge.ReadableType.Number -> ids.getDouble(i).toInt()
        com.facebook.react.bridge.ReadableType.String -> ids.getString(i)?.toIntOrNull() ?: 0
        else -> 0
      }
      if (id > 0) parsed.add(id)
    }
    IncomingOrderNotifier.syncMuted(reactContext, parsed)
  }

  @ReactMethod
  fun addListener(eventName: String) {
  }

  @ReactMethod
  fun removeListeners(count: Double) {
  }

  companion object {
    @Volatile private var context: ReactApplicationContext? = null

    fun attach(next: ReactApplicationContext) {
      context = next
    }

    fun detach(current: ReactApplicationContext) {
      if (context === current) context = null
    }

    fun emit(orderId: Int, title: String, body: String) {
      val ctx = context ?: return
      if (!ctx.hasActiveReactInstance()) return
      val payload = Arguments.createMap().apply {
        putInt("orderId", orderId)
        putString("title", title)
        putString("body", body)
      }
      try {
        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit("sellerOrderRing", payload)
      } catch (_: Exception) {}
    }
  }
}
