<?php
/**
 * TrustData module for PrestaShop
 *
 * Sends server-side conversion events to TrustData via webhooks.
 *
 * Hooks:
 *   actionValidateOrder        → purchase  (equivalent: Shopify orders/paid)
 *   actionOrderSlipAdd         → refund    (equivalent: Shopify orders/updated with refunds)
 *   actionOrderStatusUpdate    → refund    (equivalent: Shopify orders/cancelled)
 *   actionCustomerAccountAdd   → signup    (equivalent: Shopify customers/create)
 */

if (!defined('_PS_VERSION_')) {
    exit;
}

require_once __DIR__ . '/classes/TrustDataApi.php';

class TrustData extends Module
{
    const CONFIG_ATTRIBUTION_ID = 'TRUSTDATA_ATTRIBUTION_ID';
    const CONFIG_API_KEY        = 'TRUSTDATA_API_KEY';
    const CONFIG_SERVER_URL     = 'TRUSTDATA_SERVER_URL';
    const DEFAULT_SERVER_URL    = 'https://t.trustdata.tech';

    public function __construct()
    {
        $this->name                   = 'trustdata';
        $this->tab                    = 'analytics_stats';
        $this->version                = '1.0.0';
        $this->author                 = 'TrustData';
        $this->need_instance          = 0;
        $this->ps_versions_compliancy = ['min' => '1.7', 'max' => _PS_VERSION_];
        $this->bootstrap              = true;

        parent::__construct();

        $this->displayName = $this->l('TrustData');
        $this->description = $this->l('Marketing attribution and conversion tracking.');
    }

    // =========================================================
    // Install / Uninstall
    // =========================================================

    public function install()
    {
        return parent::install()
            && $this->registerHook('actionValidateOrder')
            && $this->registerHook('actionOrderSlipAdd')
            && $this->registerHook('actionOrderStatusUpdate')
            && $this->registerHook('actionCustomerAccountAdd');
    }

    public function uninstall()
    {
        Configuration::deleteByName(self::CONFIG_ATTRIBUTION_ID);
        Configuration::deleteByName(self::CONFIG_API_KEY);
        Configuration::deleteByName(self::CONFIG_SERVER_URL);

        return parent::uninstall();
    }

    // =========================================================
    // Admin configuration page
    // =========================================================

    public function getContent()
    {
        $output = '';

        if (Tools::isSubmit('submit_trustdata')) {
            $attributionId = Tools::getValue(self::CONFIG_ATTRIBUTION_ID);
            $apiKey        = Tools::getValue(self::CONFIG_API_KEY);
            $serverUrl     = Tools::getValue(self::CONFIG_SERVER_URL);

            if (empty($attributionId) || empty($apiKey)) {
                $output .= $this->displayError($this->l('Attribution ID and API Key are required.'));
            } else {
                Configuration::updateValue(self::CONFIG_ATTRIBUTION_ID, $attributionId);
                Configuration::updateValue(self::CONFIG_API_KEY, $apiKey);
                Configuration::updateValue(self::CONFIG_SERVER_URL, rtrim($serverUrl, '/') ?: self::DEFAULT_SERVER_URL);
                $output .= $this->displayConfirmation($this->l('Settings saved.'));
            }
        }

        return $output . $this->renderConfigForm();
    }

    private function renderConfigForm()
    {
        $fieldsForm = [
            'form' => [
                'legend' => ['title' => $this->l('TrustData Settings'), 'icon' => 'icon-cog'],
                'input'  => [
                    [
                        'type'     => 'text',
                        'label'    => $this->l('Attribution ID'),
                        'name'     => self::CONFIG_ATTRIBUTION_ID,
                        'required' => true,
                        'desc'     => $this->l('Found in TrustData dashboard → Settings → Attribution IDs.'),
                    ],
                    [
                        'type'     => 'text',
                        'label'    => $this->l('API Key'),
                        'name'     => self::CONFIG_API_KEY,
                        'required' => true,
                        'desc'     => $this->l('Webhook API key from Settings → Attribution IDs → Webhooks tab.'),
                    ],
                    [
                        'type'  => 'text',
                        'label' => $this->l('Server URL'),
                        'name'  => self::CONFIG_SERVER_URL,
                        'desc'  => $this->l('Leave blank unless you use a custom tracking domain.'),
                    ],
                ],
                'submit' => ['title' => $this->l('Save'), 'class' => 'btn btn-default pull-right'],
            ],
        ];

        $helper                                    = new HelperForm();
        $helper->submit_action                     = 'submit_trustdata';
        $helper->fields_value[self::CONFIG_ATTRIBUTION_ID] = Configuration::get(self::CONFIG_ATTRIBUTION_ID);
        $helper->fields_value[self::CONFIG_API_KEY]        = Configuration::get(self::CONFIG_API_KEY);
        $helper->fields_value[self::CONFIG_SERVER_URL]     = Configuration::get(self::CONFIG_SERVER_URL)
            ?: self::DEFAULT_SERVER_URL;

        return $helper->generateForm([$fieldsForm]);
    }

    // =========================================================
    // Hooks
    // =========================================================

    /**
     * Shopify equivalent: orders/paid
     * Fires when an order is validated (payment confirmed).
     */
    public function hookActionValidateOrder(array $params)
    {
        if (!$this->isConfigured()) {
            return;
        }

        /** @var Order    $order    */
        $order = $params['order'];
        /** @var Customer $customer */
        $customer = $params['customer'];
        /** @var Currency $currency */
        $currency = $params['currency'];

        $visitorId = $this->getVisitorId();

        // Products
        $products = [];
        foreach ($order->getProducts() as $product) {
            $products[] = [
                'id'       => (string) ($product['product_reference'] ?: $product['product_id']),
                'name'     => $product['product_name'],
                'sku'      => $product['product_reference'] ?: null,
                'price'    => (float) $product['unit_price_tax_incl'],
                'quantity' => (int) $product['product_quantity'],
            ];
        }

        // Delivery address
        $address = new Address((int) $order->id_address_delivery);

        $payload = [
            'conversion_id' => (string) $order->id,
            'value'         => (float) $order->total_paid_tax_incl,
            'currency'      => $currency->iso_code,
            'shipping'      => (float) $order->total_shipping_tax_incl,
            'discount'      => (float) $order->total_discounts_tax_incl,
            'visitor_id'    => $visitorId,
            'user_data'     => [
                'email'      => $customer->email,
                'first_name' => $customer->firstname,
                'last_name'  => $customer->lastname,
                'address'    => [
                    'city'        => $address->city,
                    'postal_code' => $address->postcode,
                    'country'     => Country::getIsoById((int) $address->id_country),
                ],
            ],
            'products' => $products,
        ];

        $this->getApi()->send('purchase', $payload);
    }

    /**
     * Shopify equivalent: orders/updated (with refunds array)
     * Fires when a credit slip (refund) is created.
     */
    public function hookActionOrderSlipAdd(array $params)
    {
        if (!$this->isConfigured()) {
            return;
        }

        /** @var Order $order */
        $order       = $params['order'];
        $productList = $params['productList'];

        // Get the latest slip ID for deduplication
        $slipId = Db::getInstance()->getValue(
            'SELECT MAX(id_order_slip) FROM `' . _DB_PREFIX_ . 'order_slip`
             WHERE `id_order` = ' . (int) $order->id
        );

        $refundAmount = 0;
        $products     = [];
        foreach ($productList as $product) {
            $lineTotal     = (float) $product['unit_price_tax_incl'] * (int) $product['quantity'];
            $refundAmount += $lineTotal;
            $products[]    = [
                'id'       => (string) ($product['reference'] ?: $product['id_product']),
                'name'     => $product['name'],
                'price'    => (float) $product['unit_price_tax_incl'],
                'quantity' => (int) $product['quantity'],
            ];
        }

        $payload = [
            'conversion_id' => 'refund_' . ($slipId ?: $order->id),
            'value'         => $refundAmount,
            'currency'      => Currency::getIsoCodeById((int) $order->id_currency),
            'products'      => $products,
        ];

        $this->getApi()->send('refund', $payload);
    }

    /**
     * Shopify equivalent: orders/cancelled
     * Fires on every order status change — we only act on cancellations.
     */
    public function hookActionOrderStatusUpdate(array $params)
    {
        if (!$this->isConfigured()) {
            return;
        }

        /** @var OrderState $newStatus */
        $newStatus = $params['newOrderStatus'];

        if ((int) $newStatus->id !== (int) Configuration::get('PS_OS_CANCELED')) {
            return;
        }

        $order = new Order((int) $params['id_order']);
        if (!Validate::isLoadedObject($order)) {
            return;
        }

        $payload = [
            'conversion_id' => 'cancelled_' . $order->id,
            'value'         => (float) $order->total_paid_tax_incl,
            'currency'      => Currency::getIsoCodeById((int) $order->id_currency),
        ];

        $this->getApi()->send('refund', $payload);
    }

    /**
     * Shopify equivalent: customers/create
     * Fires when a new customer account is created.
     */
    public function hookActionCustomerAccountAdd(array $params)
    {
        if (!$this->isConfigured()) {
            return;
        }

        /** @var Customer $customer */
        $customer  = $params['newCustomer'];
        $visitorId = $this->getVisitorId();

        $payload = [
            'conversion_id' => 'customer_' . $customer->id,
            'visitor_id'    => $visitorId,
            'user_data'     => [
                'email'      => $customer->email,
                'first_name' => $customer->firstname,
                'last_name'  => $customer->lastname,
            ],
        ];

        $this->getApi()->send('signup', $payload);
    }

    // =========================================================
    // Helpers
    // =========================================================

    private function isConfigured()
    {
        return (bool) Configuration::get(self::CONFIG_ATTRIBUTION_ID)
            && (bool) Configuration::get(self::CONFIG_API_KEY);
    }

    /**
     * Read the TrustData visitor ID from cookie.
     * Set by the JS SDK on the storefront.
     */
    private function getVisitorId()
    {
        return isset($_COOKIE['_trdt_vid']) ? $_COOKIE['_trdt_vid'] : null;
    }

    private function getApi()
    {
        $serverUrl = Configuration::get(self::CONFIG_SERVER_URL) ?: self::DEFAULT_SERVER_URL;

        return new TrustDataApi(
            $serverUrl,
            Configuration::get(self::CONFIG_ATTRIBUTION_ID),
            Configuration::get(self::CONFIG_API_KEY)
        );
    }
}
