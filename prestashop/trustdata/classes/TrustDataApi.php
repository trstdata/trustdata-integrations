<?php
/**
 * TrustData API client
 * Sends conversion events to the TrustData webhook endpoint.
 */

if (!defined('_PS_VERSION_')) {
    exit;
}

class TrustDataApi
{
    /** @var string */
    private $serverUrl;

    /** @var string */
    private $attributionId;

    /** @var string */
    private $apiKey;

    public function __construct($serverUrl, $attributionId, $apiKey)
    {
        $this->serverUrl = rtrim($serverUrl, '/');
        $this->attributionId = $attributionId;
        $this->apiKey = $apiKey;
    }

    /**
     * Send an event to TrustData.
     *
     * @param string $topic   Event topic: purchase, refund, signup
     * @param array  $payload Event payload
     *
     * @return bool True on success
     */
    public function send($topic, array $payload)
    {
        $payload = $this->cleanPayload($payload);

        $url = sprintf(
            '%s/webhooks/custom/%s/%s',
            $this->serverUrl,
            urlencode($this->attributionId),
            urlencode($topic)
        );

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST        => true,
            CURLOPT_POSTFIELDS  => json_encode($payload),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT     => 5,
            CURLOPT_HTTPHEADER  => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $this->apiKey,
            ],
        ]);

        curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        return $httpCode === 200;
    }

    /**
     * Recursively remove null and empty-string values from payload.
     */
    private function cleanPayload(array $data)
    {
        $result = [];
        foreach ($data as $key => $value) {
            if ($value === null || $value === '') {
                continue;
            }
            if (is_array($value)) {
                $cleaned = $this->cleanPayload($value);
                if (!empty($cleaned)) {
                    $result[$key] = $cleaned;
                }
            } else {
                $result[$key] = $value;
            }
        }

        return $result;
    }
}
