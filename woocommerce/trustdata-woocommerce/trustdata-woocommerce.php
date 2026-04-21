<?php
/**
 * Plugin Name: TrustData for WooCommerce
 * Plugin URI:  https://docs.trustdata.tech/connectors/woocommerce
 * Description: Saves the TrustData visitor ID to order meta so it is included in WooCommerce webhooks for session matching.
 * Version:     1.0.0
 * Author:      TrustData
 * License:     MIT
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * WC requires at least: 7.0
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Save the TrustData visitor ID (_trdt_vid cookie) to order meta when an order is created.
 * The value is included in WooCommerce webhook payloads under meta_data,
 * where TrustData reads it as _td_visitor_id for session matching.
 */
add_action('woocommerce_checkout_order_created', function (WC_Order $order) {
    $visitorId = isset($_COOKIE['_trdt_vid']) ? sanitize_text_field($_COOKIE['_trdt_vid']) : '';

    if ($visitorId !== '') {
        $order->update_meta_data('_td_visitor_id', $visitorId);
        $order->save();
    }
});
