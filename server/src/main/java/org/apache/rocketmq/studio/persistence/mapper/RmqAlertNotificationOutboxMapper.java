/*
Licensed to the Apache Software Foundation (ASF) under one or more
contributor license agreements.  See the NOTICE file distributed with
this work for additional information regarding copyright ownership.
The ASF licenses this file to You under the Apache License, Version 2.0.
*/
package org.apache.rocketmq.studio.persistence.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;
import org.apache.rocketmq.studio.persistence.entity.RmqAlertNotificationOutbox;

import java.time.LocalDateTime;
import java.util.List;

public interface RmqAlertNotificationOutboxMapper extends BaseMapper<RmqAlertNotificationOutbox> {
    @Select("SELECT * FROM rmq_alert_notification_outbox WHERE "
            + "(status IN ('PENDING', 'RETRY_WAIT') AND next_attempt_at <= #{now}) "
            + "OR (status = 'SENDING' AND (sending_started_at IS NULL OR sending_started_at <= #{staleBefore})) "
            + "ORDER BY id LIMIT #{limit}")
    List<RmqAlertNotificationOutbox> findDispatchable(@Param("now") LocalDateTime now,
            @Param("staleBefore") LocalDateTime staleBefore, @Param("limit") int limit);

    @Update("UPDATE rmq_alert_notification_outbox SET status = 'SENDING', sending_started_at = #{claimedAt} "
            + "WHERE id = #{id} AND ((status IN ('PENDING', 'RETRY_WAIT') AND next_attempt_at <= #{now}) "
            + "OR (status = 'SENDING' AND (sending_started_at IS NULL OR sending_started_at <= #{staleBefore})))")
    int claimForDispatch(@Param("id") Long id, @Param("now") LocalDateTime now,
            @Param("staleBefore") LocalDateTime staleBefore, @Param("claimedAt") LocalDateTime claimedAt);
}
